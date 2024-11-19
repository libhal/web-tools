// Copyright 2024 Khalil Estell
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

class SerialDevice {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.onDataCallback = null;
    this.baudRateSource = 115200;
    this.onConnectCallback = null;
    this.onDisconnectCallback = null;
    this.connected = false;
    this.received_data = new Array();
    this.read_index = 0;
    this.invertedBoot = true;
  }

  // Method to request and open a serial port
  async connect() {
    if ("serial" in navigator) {
      try {
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate: 115200 });
        await this.port.setSignals({
          dataTerminalReady: false,
          requestToSend: false,
        });
        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();
        console.log("Connected to the serial port!");
        this.startReading();
        this.connected = true;
        if (this.onConnectCallback) {
          await this.onConnectCallback();
        }
      } catch (error) {
        console.error("There was an error opening the serial port:", error);
        this.connected = false;
      }
    } else {
      console.error("WebSerial API not supported.");
    }
  }

  // Private method to start reading from the serial port
  async startReading() {
    this.read_index = 0;
    this.received_data = new Array();

    while (this.port && this.port.readable) {
      try {
        const { value, done } = await this.reader.read();
        if (done) {
          console.log("Reader stream closed");
          this.reader.releaseLock();
          break;
        }
        if (this.onDataCallback) {
          this.onDataCallback(new TextDecoder("utf-8").decode(value));
        } else {
          this.received_data.push(...Array.from(value));
        }
      } catch (error) {
        console.error("Error reading from serial port:", error);
        this.reader.releaseLock();
        this.read_index = 0;
        this.received_data = new Array();
        this.disconnect();
        break;
      }
    }
  }

  async read(read_count, timeout_time_ms) {
    let timed_out = false;

    let handle = setTimeout(() => {
      timed_out = true;
    }, timeout_time_ms);

    while (this.received_data.length - this.read_index < read_count && this.port.readable) {
      if (timed_out) {
        throw (new Error(`Read of count '${read_count}' and timeout time ${timeout_time_ms} has timed out.`));
      }
      await sleep(1);
    }

    clearTimeout(handle);

    let result = this.received_data.slice(this.read_index, this.read_index + read_count);
    this.read_index += read_count;

    return result;
  }

  onData(callback) {
    this.onDataCallback = callback;
  }

  onConnect(callback) {
    this.onConnectCallback = callback;
  }

  onDisconnect(callback) {
    this.onDisconnectCallback = callback;
  }

  setBaudRateSourceCallback(callback) {
    this.baudRateSource = callback;
  }

  isConnected() {
    return this.connected;
  }

  async setSignals(signals) {
    if (this.invertedBoot) {
      let invertedBoot = !(signals.requestToSend);
      signals.requestToSend = invertedBoot;
    }
    await this.port.setSignals(signals);
  }

  async write(data) {
    try {
      const encoder = new TextEncoder("utf-8");
      await this.writer.write(encoder.encode(data));
    } catch (error) {
      console.error("Failed to write to serial port:", error);
    }
  }

  async disconnect() {
    try {
      this.connected = false;
      this.reader && this.reader.releaseLock();
      this.writer && (await this.writer.close());
      this.port && (await this.port.close());
      this.port = null;
      console.log("Disconnected from the serial port");
      this.connected = false;
      if (this.onDisconnectCallback) {
        this.onDisconnectCallback();
      }
    } catch (error) {
      console.error("Failed to close the serial port:", error);
    }
  }
}
