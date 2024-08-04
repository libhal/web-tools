// copied constants from svelte app
const MAX_WRITE_BLOCK_SIZE_STM32 = 256;
const MAX_READ_BLOCK_SIZE = 256;
const MAX_WRITE_BLOCK_SIZE_STM8 = 128;

// use control signals to trigger bootloader activation and device hardware reset
// false = pin high, true = pin low
const RESET_PIN = "dataTerminalReady";
const BOOT0_PIN = "requestToSend"; // STM32
const PIN_HIGH = false;
const PIN_LOW = true;

const SYNCHR = 0x7F;
const ACK = 0x79;
const NACK = 0x1F;

const CMD_GET = 0x00;
const CMD_GV = 0x01;
// GET ID command used to identify the STM family. If it's present it's STM32, STM8 otherwise
const CMD_GID = 0x02;
const CMD_READ = 0x11;
const CMD_GO = 0x21;
const CMD_WRITE = 0x31;
const CMD_ERASE = 0x43;
const CMD_EXTENDED_ERASE = 0x44;
const CMD_WPUN = 0x73;
const CMD_RDU_PRM = 0x92;

// Address for erase_write_routines for STM8 S/A
const STM8_WRITE_CODE_ADDRESS = 0xA0;

const EwrLoadState = Object.freeze({
  NOT_LOADED: Symbol("not_loaded"),
  LOADING: Symbol("loading"),
  LOADED: Symbol("loaded")
});

const tools = {
  num2a: function (number, arraySize) {
    var i, temp = number, result = [];

    for (i = 0; i < arraySize; i++) {
      result.unshift(temp & 0xFF);
      temp = temp >> 8;
    }

    return result;
  },

  b2hexstr: function (byte) {
    return ("00" + byte.toString(16)).substr(-2);
  },
}

function u8a(array) {
  return new Uint8Array(array);
}

function readFile() {
  return new Promise((resolve, reject) => {
    console.log('Sending request..');
    const req = new XMLHttpRequest();
    req.open("GET", "./mod-stm32f1-v4-Debug.bin", true);
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

function handleReceivedData(data) {
  console.log(data);
}

class InfoGET {
  constructor() {
    // Bootloader version
    this.blVersion = null;
    // List of supported commands
    this.commands = [];
  }

  getFamily() {
    return this.commands.indexOf(CMD_GID) === -1 ? 'STM8' : 'STM32';
  }
}

class StmDevice extends SerialDevice {
  constructor() {
    super();
    this.replyMode = false;
    this.ewrLoadState = EwrLoadState.NOT_LOADED;
    this.writeBlockSize = MAX_WRITE_BLOCK_SIZE_STM32;
    this.readBlockSize = MAX_READ_BLOCK_SIZE;
    this.commands = [];
    this.onFlashCallback = null;
    this.flashContent = null;

    // device info
    this.bootLoaderVersion = null;
    this.deviceType = null;
    this.pid = null;
  }

  onFlash(callback) {
    this.onFlashCallback = callback;
  }

  async readResponse() {
    try {
      let result = null;
      result = await this.reader.read();
      return result.value;
    } catch (error) {
      console.log(error);
    }
  }

  async flash(go) {
    try {
      console.log('Erasing flash...');
      await this.eraseAll();
      console.log('Parsing content of the file');
      this.flashContent = await readFile();
      let startAddress;
      let records;
      startAddress = parseInt("0x8000000");
      records = [
        {
          type: 'data',
          data: this.flashContent,
          address: startAddress,
        },
      ];

      for (let i = 0; i < records.length; i++) {
        let rec = records[i];

        if (rec.type === 'data') {
          console.log(`Rec address: ${rec.address.toString(16)}`);
          await this.writeToAddress(rec.data, rec.address);
          console.log('STM Write complete.');
        } else if (rec.type === 'start') {
          console.log(
            `Start address detected: 0x${rec.address.toString(16)}`
          );
          startAddress = rec.address;
        }
      }
      if (go) {
        startAddress =
          startAddress || parseInt("0x8000000");
        console.log('Starting code execution');

        await this.cmdGO(startAddress);
        await sleep(100);
        await this.setSignals({
          dataTerminalReady: false, // RESET HIGH
          requestToSend: false, // return BOOT to HIGH?
        });
        console.log('out of bootloader?');
      }
    }
    catch (error) {
      console.log(error);
    }
  }

  async cmdGET() {
    if (this.isConnected()) {
      try {
        await this.writer.write(u8a([SYNCHR]));
        let resp = await this.readResponse();
        let response = Array.from(resp);
        if (response[0] !== ACK) {
          throw new Error('Unexpected response');
        }
        await this.writer.write(u8a([CMD_GET, 0xFF]));
        resp = await this.readResponse();
        response = Array.from(resp);

        if (response.length === 1) {
          let res = await this.readResponse();
          let secondResponse = Array.from(res);
          if (secondResponse.length > 1) {
            for (let i = 0; i < secondResponse.length; i++) {
              response[1 + i] = secondResponse[i];
            }
          }
        }

        let info = new InfoGET();
        info.blVersion = (response[2] >> 4) + '.' + (response[2] & 0x0F);
        this.bootLoaderVersion = info.blVersion;
        console.log(`bl version: ${info.blVersion}`);

        for (let i = 0; i < response[1]; i++) {
          info.commands.push(response[3 + i]);
        }
        this.commands = info.commands;
        console.log(`commands count: ${this.commands.length}`);

        if (info.getFamily() === 'STM32') {
          this.deviceType = 'STM32';
          this.writeBlockSize = MAX_WRITE_BLOCK_SIZE_STM32;
          this.ewrLoadState = EwrLoadState.LOADED;
        } else {
          this.writeBlockSize = MAX_WRITE_BLOCK_SIZE_STM8;
        }
      } catch (error) {
        console.log(`Connection must be established before sending commands. Error thrown: ${error}`);
      }
    }
  }

  // NOT TESTED
  async cmdGO(address) {
    try {
      let addressFrame;

      if (!Number.isInteger(address)) {
        throw (new Error('Invalid address parameter'));
      }

      if (!this.isConnected()) {
        throw (new Error('Connection must be established before sending commands'));
      }

      addressFrame = tools.num2a(address, 4);
      addressFrame.push(this.calcChecksum(addressFrame, false));

      await this.writer.write(u8a([CMD_GO, 0xDE]));
      let response = await this.read(1, 200);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response sending GO command');
      }
      await this.writer.write(u8a(addressFrame));
      response = await this.read(1, 200);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response writing address frame');
      }
      console.log('done sending GO command...');
    }
    catch (error) {
      console.log(error);
    }
  }

  async cmdWRITE(data, address) {
    try {
      if (!(data instanceof Uint8Array)) {
        throw (new Error('Missing data to write'));
      }

      if (!Number.isInteger(address) || address < 0) {
        throw (new Error('Invalid address parameter'));
      }

      if (data.length > this.writeBlockSize) {
        throw (new Error('Data is too big, use write()'));
      }

      if (!this.commands.length) {
        throw (new Error('Execute GET command first'));
      }

      if (!this.isConnected()) {
        throw (new Error('Connection must be established before sending commands'));
      }

      // Frame: number of bytes to be written (1 byte), the data (N + 1 bytes) (multiple of 4) and checksum
      let response = null;
      let checksum = this.calcChecksum(data, true);
      let frame = new Uint8Array(data.length + 2);
      frame[0] = [data.length - 1]; // 
      frame.set(data, 1);
      frame[frame.length - 1] = checksum;

      let addressFrame = tools.num2a(address, 4);
      addressFrame.push(this.calcChecksum(addressFrame, false));
      await this.writer.write(u8a([CMD_WRITE, 0xCE]));
      // await sleep(1);
      response = await this.read(1, 200);
      if (response[0] !== ACK) {
        console.log(response);
        throw new Error('Unexpected response sending WRITE');
      }

      await this.writer.write(u8a(addressFrame));
      response = await this.read(1, 200);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response writing addressframe');
      }
      await this.writer.write(frame);
      response = await this.read(1, 2000); // stops here
      if (response[0] !== ACK) {
        throw new Error('Unexpected response writing frame');
      }
    }
    catch (error) {
      console.log(error);
    }
  }

  async cmdGID() {
    try {
      if (!this.commands.length) {
        throw (new Error('Execute GET command first'));
      }

      if (this.commands.indexOf(CMD_GID) === -1) {
        throw (new Error('GET ID command is not supported by the current target'));
      }

      if (!this.isConnected()) {
        throw (new Error('Connection must be established before sending commands'));
      }

      await this.writer.write(u8a([CMD_GID, 0xFD]));
      await sleep(15); // need time to read all bytes
      let res = await this.readResponse();
      let response = Array.from(res);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response getting id');
      }
      let pid = '0x' + tools.b2hexstr(response[2]) + tools.b2hexstr(response[3]);
      console.log(pid);
      this.pid = pid;
    }
    catch (error) {
      console.log(error);
    }
  }

  async writeToAddress(data, address, onProgress) {
    try {
      this.startReading();
      console.log('Writing ' + data.length + ' bytes to flash at address 0x' + address.toString(16) + ' using ' + this.writeBlockSize + ' bytes chunks');
      if (!this.isConnected()) {
        throw (new Error('Connection must be established before sending commands'));
      }

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
        // if (onProgress) {
        //   onProgress(i, blocksCount);
        // }
        await this.cmdWRITE(block.data, address + i * this.writeBlockSize);
      }

      console.log('Finished writing');
    }
    catch (err) {
      console.log(err);
    }
  }

  async eraseAll() {
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

      await this.writer.write(u8a([CMD_ERASE, 0xFF ^ CMD_ERASE]));
      let res = await this.readResponse();
      let response = Array.from(res);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response');
      }
      await this.writer.write(u8a([0xFF, 0x00]));
      await sleep(30);
      res = await this.readResponse();
      response = Array.from(res);
      if (response[0] !== ACK) {
        throw new Error('Unexpected response');
      }
      console.log('Erase flash complete!');
    }
    catch (error) {
      console.log(error);
    }
  }

  calcChecksum(data, wLength) {
    let result = 0;

    for (let i = 0; i < data.length; i += 1) {
      result = result ^ data[i];
    }

    if (wLength) {
      result = result ^ (data.length - 1);
    }

    return result;
  }
}