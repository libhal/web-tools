const serialDevice = new StmDevice();

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const uptime_start = Date.now();
const binary_link = "../resources/binaries/mod-stm32f1-v5-Debug.bin";

const serial_can_standard_message_regex =
  /([rt])([0-9A-Fa-f]{3})([0-8])(([0-9A-Fa-f]{2}){0,8})/i;
const serial_can_extended_message_regex =
  /([RT])([0-9A-Fa-f]{8})([0-8])(([0-9A-Fa-f]{2}){0,8})/i;
let can_message_buffer = "";

function updateTable(command) {
  let match;

  if (command.data[0] == "r" || command.data[0] == "t") {
    match = command.data.match(serial_can_standard_message_regex);
  } else {
    match = command.data.match(serial_can_extended_message_regex);
  }

  if (match) {
    console.log("Full match: ", match[0]);
    console.log("Type: ", match[1]);
    console.log("Message ID: ", match[2]);
    console.log("Length: ", match[3]);
    console.log("Data ", match[4]);

    let receive_time = Date.now() - uptime_start;
    let table_entry = "";
    if (command.outgoing) {
      table_entry = "<tr class='self_row'>";
    } else {
      table_entry = "<tr>";
    }
    table_entry += `
      <td>${receive_time}</td>
      <td>${match[1]}</td>
      <td>${parseInt(match[2], 16).toString(16).padStart(8, "0")}</td>
    `;
    let length = parseInt(match[3]);
    table_entry += "<td>";
    for (let i = 0; i < length; i++) {
      table_entry += `${match[4][i * 2]}${match[4][i * 2 + 1]} `;
    }
    table_entry += "</td>";
    for (let i = length; i < 8; i++) {
      table_entry += "<td></td>";
    }
    table_entry += "</tr>";
    console.log(`table_entry = ${table_entry}`);
    const output_table = document.querySelector("#output_table_body");
    output_table.innerHTML = table_entry + output_table.innerHTML;
  } else {
    console.warn(
      "unmatched = ",
      command,
      new TextEncoder("utf-8").encode(command)
    );
  }
}

// [DEV NOTE]: Execute this function directly in the chrome console to test
// receiving data without needing to connect a device.
async function handleReceivedData(data) {
  console.log(data);

  if (data.includes("\x07")) {
    console.error("Serial Can responded with an error response!");
    can_message_buffer = "";
    return;
  }

  can_message_buffer += data;
  let end_of_command = can_message_buffer.indexOf("\r");

  // Keep parsing out data until the message buffer is empty
  while (end_of_command != -1) {
    let current_command = can_message_buffer.substring(0, end_of_command + 1);
    can_message_buffer = can_message_buffer.substring(end_of_command + 2);
    updateTable({ data: current_command, outgoing: false });
    end_of_command = can_message_buffer.indexOf("\r");
  }
}

async function sendCanMessage() {
  if (!serialDevice.isConnected()) {
    return;
  }

  const message_id = parseInt(document.querySelector("#message_id").value, 16);
  const length = parseInt(document.querySelector("#length").value);
  const valid_length = 0 <= length && length <= 8;
  let data = [
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

  // Remove the data elements we do not need
  data = data.splice(0, length);

  if (data.some(Number.isNaN)) {
    console.error("Invalid data field!");
    return;
  }

  const extended = document.querySelector("#extended_id").checked;
  const remote_frame = document.querySelector("#remote_frame").checked;
  const letter_map = [
    // [0] = data [1] = remote_frame
    ["t", "r"], // extended == false
    ["T", "R"], // extended == true
  ];
  const selected_letter = letter_map[Number(extended)][Number(remote_frame)];

  console.log("extended = ", extended);
  console.log("remote_frame = ", remote_frame);
  console.log("selected letter = ", selected_letter);

  let payload = selected_letter;
  if (extended) {
    payload += message_id.toString(16).padStart(8, "0");
  } else {
    payload += message_id.toString(16).padStart(3, "0");
  }
  payload += length;

  for (let i = 0; i < data.length; i++) {
    payload += data[i].toString(16).padStart(2, "0");
  }
  payload += "\r";

  console.log("sending...", payload);

  await serialDevice.write(payload);

  updateTable({ data: payload, outgoing: true });
}

async function sendCodeFilter() {
  if (!serialDevice.isConnected()) {
    return;
  }
  let code_payload = "M4400000\r";
  console.log("sending code_payload...", code_payload);
  await serialDevice.write(code_payload);
}

async function sendMaskFilter() {
  if (!serialDevice.isConnected()) {
    return;
  }
  let mask_payload = "m7c00000\r";
  console.log("sending mask_payload...", mask_payload);
  await serialDevice.write(mask_payload);
}

/**
 * Update progress bar to reflect the percentage of the programming state
 *
 * @param {double} percentage - from 0.0 to 1.0
 */
function updateProgressBar(percentage) {
  const program_progress_bar = document.querySelector("#flash-progress");
  const scaled_percent = Math.ceil(percentage * 100.0);
  program_progress_bar.style.width = `${scaled_percent}%`;
  program_progress_bar.innerHTML = `${scaled_percent}%`;
}

document.addEventListener("DOMContentLoaded", () => {
  serialDevice.setBaudRateSourceCallback(() => {
    return document.querySelector("#baudrate").value;
  });

  serialDevice.onConnect(async () => {
    try {
      serialDevice.error = null;
      const close_button = document.querySelector("#close-programming-modal");
      close_button.setAttribute("disabled", true);
      close_button.classList.replace("btn-primary", "btn-secondary");
      document.querySelector("#program-status-message").innerText =
        "Flashing latest firmware. Please wait...";
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
        requestToSend: true,
      });

      await sleep(200);

      await serialDevice.setSignals({
        dataTerminalReady: false,
        requestToSend: true,
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

      if (0) {
        // This is here for debugging purposes. Remove later
        await sendCodeFilter();
        await sleep(50);

        await sendMaskFilter();
        await sleep(50);
      }

      console.log("sending O");
      await serialDevice.write("O\r");
      await sleep(50);
      document.querySelector("#upgrade").removeAttribute("disabled");
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
    document.querySelector("#baudrate").removeAttribute("disabled");
    document.querySelector("#can-bitrate").removeAttribute("disabled");
    document.querySelector("#upgrade").setAttribute("disabled", true);

    if (serialDevice.error) {
      const close_button = document.querySelector("#close-programming-modal");
      document.querySelector("#program-status-message").innerText =
        serialDevice.error;
      close_button.removeAttribute("disabled");
      close_button.classList.replace("btn-secondary", "btn-primary");
    }
  });

  serialDevice.onData(handleReceivedData);

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

  document.querySelector("#length").addEventListener("change", (event) => {
    console.log("length update!");
    if (event.target.value > 8) {
      event.target.value = 8;
    }
    if (event.target.value < 0) {
      event.target.value = 0;
    }

    const data = [
      document.querySelector("#data_0"),
      document.querySelector("#data_1"),
      document.querySelector("#data_2"),
      document.querySelector("#data_3"),
      document.querySelector("#data_4"),
      document.querySelector("#data_5"),
      document.querySelector("#data_6"),
      document.querySelector("#data_7"),
    ];

    for (let i = 0; i < event.target.value; i++) {
      data[i].removeAttribute("disabled");
    }

    for (let i = event.target.value; i < 8; i++) {
      data[i].setAttribute("disabled", true);
    }
  });

  document.querySelector("#transmit").addEventListener("click", sendCanMessage);

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

  document.querySelector("#upgrade").addEventListener("click", async () => {
    const close_button = document.querySelector("#close-programming-modal");
    const flash_status = document.querySelector("#program-status-message");
    close_button.setAttribute("disabled", true);

    await serialDevice.flash(updateProgressBar);
    if (serialDevice.isConnected()) {
      flash_status.innerText =
        "Flash complete! Close to start using CanOpener!";
      close_button.removeAttribute("disabled");
      close_button.classList.replace("btn-secondary", "btn-primary");
    }
  });

  document
    .querySelector("#close-programming-modal")
    .addEventListener("click", async () => {
      try {
        if (serialDevice.isConnected()) {
          await sleep(300);
          await serialDevice.onConnectCallback();
        }
      } catch (error) {
        await serialDevice.disconnect();
      }
    });
});
