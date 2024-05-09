const serialDevice = new SerialDevice();

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const uptime_start = Date.now();

const serial_can_message_regex =
  /([rRtT])([0-9A-Fa-f]{3})([0-8])(([0-9A-Fa-f]{2}){0,8})/i;
let can_message_buffer = "";

document.addEventListener("DOMContentLoaded", () => {
  serialDevice.setBaudRateSourceCallback(() => {
    return document.querySelector("#baudrate").value;
  });

  serialDevice.onConnect(async () => {
    try {
      document.querySelector("#connect-btn").innerText = "Disconnect";
      document
        .querySelector("#connect-btn")
        .classList.replace("btn-success", "btn-danger");
      document.querySelector("#baudrate").setAttribute("disabled", true);
      document.querySelector("#can-bitrate").setAttribute("disabled", true);

      console.log("Resetting Device");

      await sleep(200);

      await serialDevice.setSignals({
        dataTerminalReady: true,
        requestToSend: false,
      });

      await sleep(200);

      await serialDevice.setSignals({
        dataTerminalReady: false,
        requestToSend: false,
      });

      await sleep(200);

      console.log("sending 4 carriage returns");
      await serialDevice.write("\r\r\r\r");
      await sleep(50);

      console.log("sending V");
      await serialDevice.write("V\r");
      await sleep(50);

      let can_bit_rate = document.querySelector("#can-bitrate").value;
      console.log(`sending ${can_bit_rate}`);
      await serialDevice.write(`${can_bit_rate}\r`);
      await sleep(50);

      console.log("sending O");
      await serialDevice.write("O\r");
      await sleep(50);
    } catch (error) {
      console.error(error);
      await serialDevice.disconnect();
    }
  });

  serialDevice.onDisconnect(() => {
    console.log("Disconnected event called!");
    const connect_btn = document.querySelector("#connect-btn");
    connect_btn.innerText = "Connect";
    connect_btn.classList.replace("btn-danger", "btn-success");
    document.querySelector("#baudrate").setAttribute("disabled", false);
    document.querySelector("#can-bitrate").setAttribute("disabled", false);
  });

  serialDevice.onData(async (data) => {
    console.log(data);

    if (data.includes("\x07")) {
      console.error("Serial Can responded with an error response!");
      can_message_buffer = "";
      return;
    }

    can_message_buffer += data;
    const end_of_command = can_message_buffer.indexOf("\r");

    if (end_of_command != -1) {
      let current_command = can_message_buffer.substring(0, end_of_command + 1);
      can_message_buffer = can_message_buffer.substring(end_of_command + 2);

      const match = current_command.match(serial_can_message_regex);
      if (match) {
        console.log("Full match: ", match[0]);
        console.log("Type: ", match[1]);
        console.log("Message ID: ", match[2]);
        console.log("Length: ", match[3]);
        console.log("Data ", match[4]);

        let receive_time = Date.now() - uptime_start;
        let table_entry = `<tr><td>${receive_time}</td><td>${match[2]}</td>`;
        let length = parseInt(match[3]);

        for (let i = 0; i < length; i++) {
          table_entry += `<td>${match[4][i * 2]}${match[4][i * 2 + 1]}</td>`;
        }
        for (let i = length; i < 8; i++) {
          table_entry += "<td></td>";
        }
        table_entry += "</tr>";
        console.log(`table_entry = ${table_entry}`);
        document.querySelector("#output_table").innerHTML += table_entry;
      } else {
        console.warn(
          "unmatched = ",
          current_command,
          new TextEncoder("utf-8").encode(current_command)
        );
      }
    }
  });

  document.querySelector("#connect-btn").addEventListener("click", async () => {
    if (!serialDevice.isConnected()) {
      serialDevice.connect();
    } else {
      serialDevice.disconnect();
    }
  });

  document.querySelector("#baudrate").addEventListener("change", function () {
    const baudrate_input = document.querySelector("#baudrate-input");
    if (this.value === "custom") {
      baudrate_input.hidden = false;
      baudrate_input.focus();
    } else {
      baudrate_input.hidden = true;
    }
  });

  document.querySelector("#transmit").addEventListener("click", async () => {
    if (!serialDevice.isConnected()) {
      return;
    }

    const message_id = parseInt(
      document.querySelector("#message_id").value,
      16
    );
    const length = parseInt(document.querySelector("#length").value);
    const valid_length = 0 <= length && length <= 8;
    const data = [
      parseInt(document.querySelector("#data_0").value, 16),
      parseInt(document.querySelector("#data_1").value, 16),
      parseInt(document.querySelector("#data_2").value, 16),
      parseInt(document.querySelector("#data_3").value, 16),
      parseInt(document.querySelector("#data_4").value, 16),
      parseInt(document.querySelector("#data_5").value, 16),
      parseInt(document.querySelector("#data_6").value, 16),
      parseInt(document.querySelector("#data_7").value, 16),
    ];

    if (!valid_length) {
      console.error("Invalid length for transmit message");
      return;
    }

    if (isNaN(message_id)) {
      console.error("Invalid message id!");
      return;
    }

    if (data.some(Number.isNaN)) {
      console.error("Invalid data field!");
      return;
    }

    let payload = "t" + message_id.toString(16).padStart(3, "0") + length;
    for (let i = 0; i < parseInt(length); i++) {
      payload += data[i].toString(16).padStart(2, "0");
    }
    payload += "\r";

    console.log("sending...", payload);

    await serialDevice.write(payload);
  });

  const inputs = [
    "#message_id",
    "#length",
    "#data_0",
    "#data_1",
    "#data_2",
    "#data_3",
    "#data_4",
    "#data_5",
    "#data_6",
    "#data_7",
  ];

  inputs.forEach(function (input) {
    const target = document.querySelector(input);
    target.addEventListener("keypress", function (event) {
      if (event.key === "Enter") {
        event.preventDefault(); // Prevent the default action
        document.querySelector("#transmit").click();
      }
    });
  });
});
