// copied constants from svelte app
const MAX_WRITE_BLOCK_SIZE = 256;
const MAX_READ_BLOCK_SIZE = 256;

const ACK = 0x79;
const SYNCHR = 0x7F;
const CMD_GET = 0x00;
const CMD_GID = 0x02;
const CMD_READ = 0x11;
const CMD_GO = 0x21;
const CMD_WRITE = 0x31;
const CMD_ERASE = 0x43;

const tools = {
  numberToArray: function (number, arraySize) {
    var i, temp = number, result = [];

    for (i = 0; i < arraySize; i++) {
      result.unshift(temp & 0xFF);
      temp = temp >> 8;
    }

    return result;
  },

  byteToHexstr: function (byte) {
    return ("00" + byte.toString(16)).substr(-2);
  },

  u8Array: function (array) {
    return new Uint8Array(array);
  },

  calcChecksum: function (data, wLength) {
    let result = 0;

    for (let i = 0; i < data.length; i += 1) {
      result = result ^ data[i];
    }

    if (wLength) {
      result = result ^ (data.length - 1);
    }

    return result;
  },

  readBinary: function (binary_name) {
    return new Promise((resolve, reject) => {
      console.log('Reading Binary..');
      const req = new XMLHttpRequest();
      req.open("GET", binary_name, true);
      req.responseType = "arraybuffer";
      req.onload = (event) => {
        const arrayBuffer = req.response;
        if (arrayBuffer) {
          const binaryBytes = new Uint8Array(arrayBuffer);
          console.log('Received binary bytes!');
          resolve(binaryBytes);
        }
      };
      req.send(null);
    });
  }
}

class StmDevice extends SerialDevice {
  constructor() {
    super();
    this.writeBlockSize = MAX_WRITE_BLOCK_SIZE;
    this.readBlockSize = MAX_READ_BLOCK_SIZE;
    this.commands = [];
    this.onFlashCallback = null;
    this.flashContent = null;

    // device info
    this.bootLoaderVersion = null;
    this.deviceType = null;
    this.pid = null;
    this.error = null;
  }

  /**
   * Closes and reopens connected port with different options and/or callback
   * @param options - Object containing options for baudrate and parity
   * @param callback - callback to run when when bytes are received
   */
  async reopenPort(options, callback) {
    this.onDataCallback = callback;
    this.reader && this.reader.releaseLock();
    this.writer && (await this.writer.close());
    this.port && (await this.port.close());
    let temp = this.port;
    this.port = null;
    this.port = temp;
    await this.port.open(options);
    await sleep(100);
    await this.port.setSignals({
      dataTerminalReady: false,
      requestToSend: false,
    });
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    console.log("Connected to STM device!");
    this.startReading();
    await this.clearBuffer();
    this.connected = true;
  }

  /**
   * Flashes connected device with latest binary for selected firmware
   * @param updateProgressBar - callback to report progress percentage
   */
  async flash(updateProgressBar) {
    let previous_handler = this.onDataCallback;
    try {
      let settings = { baudRate: 115200, parity: "even" };
      await sleep(200);
      
      console.log("Resetting Device...");
      await this.resetDevice();
      
      console.log("Activating bootloader...");
      await this.activateBootloader();
      await sleep(200);
      
      await this.reopenPort(settings, null);

      console.log("Retrieving device information...");
      await this.getDeviceInfo();

      console.log('Erasing flash...');
      await this.eraseFlash();

      const modalText = document.querySelector("#program-status-message");

      var firmware = document.getElementById("firmware-select");
      if (firmware.value == 'erase')
      {
        modalText.innerText = "Flash memory erased!";
      }
      else {
        modalText.innerText = "Flashing latest firmware. Please wait...";
        this.flashContent = await tools.readBinary(firmware.value);
        let startAddress = parseInt("0x8000000");
        
        await this.writeBlocks(this.flashContent, startAddress, updateProgressBar);
        console.log('STM Write complete.');
        
        console.log('Starting code execution');
        await this.goToAddress(startAddress);
        await this.setSignals({
          dataTerminalReady: false, // RESET HIGH
          requestToSend: true, // return BOOT to LOW
        });
        document.querySelector("#program-status-message").innerText = "Flash complete! Device is disconnected and ready to use!";
      }
      console.log("Resetting Device...");
      // double reset used to make sure device is ready to use when disconnected (needed for cmsis-dap bin)
      await this.resetDevice();
      await sleep(200);
      await this.resetDevice();
    }
    catch (error) {
      console.log(error);
      this.error = error;
      this.onDataCallback = previous_handler;
      await this.disconnect();
    }
  }

  /**
   * Empty serial read buffer.
   */
  async clearBuffer() {
    try {
      // If device is sending messages over serial before pressing the 
      // program button, the buffer will be backed up with garbage bytes.
      // This loop will readout the buffer until it times out, at which point
      // the buffer will be ready to send commands and read responses during
      // the flashing sequence.
      while (true) {
        console.log('reading...');
        await this.read(1, 100);
      }
    }
    catch (err) {
      console.log('Read buffer empty!');
    }
  }

  /**
   * Get info from device using GET and GID commands
   */
  async getDeviceInfo() {
    if (this.isConnected()) {
      try {
        this.commands = [];
        await this.writer.write(tools.u8Array([SYNCHR]));
        let response = await this.read(1, 500);
        if (response[0] !== ACK) {
          console.log(response);
          throw new Error('Unexpected response sending sync.');
        }
        await this.writer.write(tools.u8Array([CMD_GET, 0xFF]));
        response = await this.read(15, 10000);
        if (response[0] !== ACK) {
          throw new Error('Unexpected response sending GET.');
        }
        this.bootLoaderVersion = (response[2] >> 4) + '.' + (response[2] & 0x0F);
        console.log(`bl version: ${this.bootLoaderVersion}`);

        for (let i = 0; i < response[1]; i++) {
          this.commands.push(response[3 + i]);
        }
        console.log(`commands count: ${this.commands.length}`);
        if (this.commands.indexOf(CMD_GID) !== -1) {
          this.deviceType = 'STM32';
        }
        else {
          // not an STM32
          throw (new Error('Device must be STM32.'));
        }
        await this.writer.write(tools.u8Array([CMD_GID, 0xFD]));
        response = await this.read(5, 200);
        if (response[0] !== ACK) {
          throw new Error('Unexpected response getting id.');
        }
        let pid = '0x' + tools.byteToHexstr(response[2]) + tools.byteToHexstr(response[3]);
        console.log(pid);
        this.pid = pid;
      } catch (error) {
        if (this.isConnected()) {
          this.error = error;
          await this.disconnect();
        }
        console.log(error);
      }
    }
  }

  /**
   * Send bootloader GO command
   * @param {integer} address - address to go to
   */
  async goToAddress(address) {
    try {
      let addressFrame;

      if (!Number.isInteger(address)) {
        throw (new Error('Invalid address parameter'));
      }

      if (!this.isConnected()) {
        throw (new Error('Connection must be established before sending commands'));
      }

      addressFrame = tools.numberToArray(address, 4);
      addressFrame.push(tools.calcChecksum(addressFrame, false));

      await this.writer.write(tools.u8Array([CMD_GO, 0xDE]));
      let response = await this.read(1, 200);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response sending GO command');
      }
      await this.writer.write(tools.u8Array(addressFrame));
      response = await this.read(1, 200);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response writing address frame');
      }
      console.log('done sending GO command...');
    }
    catch (error) {
      if (this.isConnected()) {
        this.error = error;
        await this.disconnect();
      }
      console.log(error);
    }
  }

  /**
   * Write to STM32 device in blocks.
   * @param {ArrayBuffer} data - data to write to flash
   * @param {integer} address - address to start writing to
   * @param onProgress - callback to track progress
   */
  async writeBlocks(data, address, onProgress) {
    try {
      if (!this.isConnected()) {
        throw (new Error('Connection must be established before sending commands'));
      }

      console.log('Writing ' + data.length + ' bytes to flash at address 0x' + address.toString(16) + ' using ' + this.writeBlockSize + ' bytes chunks');
      let blocksCount = Math.ceil(data.byteLength / this.writeBlockSize);

      let offset = 0;
      let blocks = [];
      for (let i = 0; i < blocksCount; i++) {
        let block = {};

        if (i < blocksCount - 1) {
          block.data = data.subarray(offset, offset + this.writeBlockSize);
        } else {
          block.data = data.subarray(offset);
        }
        offset += block.data.length;
        blocks.push(block);
      }
      for (let i = 0; i < blocks.length; i++) {
        let block = blocks[i];
        console.log('Writing block ' + (i + 1) + '/' + blocksCount); 
        if (onProgress) {
          onProgress((i + 1) / blocksCount);
        }
        let response = null;
        let checksum = tools.calcChecksum(block.data, true);
        let frame = new Uint8Array(block.data.length + 2);
        frame[0] = [block.data.length - 1];
        frame.set(block.data, 1);
        frame[frame.length - 1] = checksum;

        let addressFrame = tools.numberToArray(address + i * this.writeBlockSize, 4);
        addressFrame.push(tools.calcChecksum(addressFrame, false));
        await this.writer.write(tools.u8Array([CMD_WRITE, 0xCE]));
        response = await this.read(1, 200);
        if (response[0] !== ACK) {
          console.log(response);
          throw new Error('Unexpected response sending WRITE');
        }
        
        await this.writer.write(tools.u8Array(addressFrame));
        response = await this.read(1, 200);
        if (response[0] !== ACK) {
          throw new Error('Unexpected response writing addressframe');
        }
        
        await this.writer.write(frame);
        response = await this.read(1, 300);
        if (response[0] !== ACK) {
          throw new Error('Unexpected response writing frame');
        }
      }
      console.log('Finished writing');
      await sleep(200);
    }
    catch (error) {
      console.log(error);
      if (this.isConnected()) {
        this.error = error;
        await this.disconnect();
      }
    }
  }

  /**
   * Erase flash memory so that there is not extra data when flashing new programs
   */
  async eraseFlash() {
    try {
      if (!this.isConnected()) {
        throw (new Error('Connection must be established before sending commands'));
      }

      if (!this.commands.length) {
        throw (new Error('Execute GET command first'));
      }

      if (this.commands.indexOf(CMD_ERASE) === -1) {
        throw (new Error('CMD_ERASE command is not supported by the current target'));
      }

      await this.writer.write(tools.u8Array([CMD_ERASE, 0xFF ^ CMD_ERASE]));
      let response = await this.read(1, 200);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response');
      }
      await this.writer.write(tools.u8Array([0xFF, 0x00]));
      await sleep(30);
      response = await this.read(1, 200);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response');
      }
      console.log('Erase flash complete!');
    }
    catch (error) {
      if (this.isConnected()) {
        this.error = error;
        await this.disconnect();
      }
      console.log(error);
    }
  }

  /**
   * Toggle reset pin to reset device.
   */
  async resetDevice() {
    await sleep(50);

    await this.setSignals({
      dataTerminalReady: true,
      requestToSend: true,
    });

    await sleep(50);

    await this.setSignals({
      dataTerminalReady: false,
      requestToSend: true,
    });

    await sleep(50);
  }

  /**
   * Toggle reset and boot pins in sequence to enter bootloader mode
   */
  async activateBootloader() {
    await this.setSignals({
      dataTerminalReady: false, // RESET HIGH
      requestToSend: true, // BOOT LOW
    });
    await sleep(50);

    await this.setSignals({
      dataTerminalReady: true, // RESET LOW
      requestToSend: true, // BOOT LOW
    });
    await sleep(50);

    await this.setSignals({
      dataTerminalReady: true, // RESET LOW
      requestToSend: false, // BOOT HIGH
    });
    await sleep(50);

    await this.setSignals({
      dataTerminalReady: false, // RESET HIGH
      requestToSend: false, // BOOT HIGH
    });
    await sleep(50);

    await this.setSignals({
      dataTerminalReady: false, // RESET HIGH
      requestToSend: true, // BOOT LOW
    });
    await sleep(50);
  }
}
