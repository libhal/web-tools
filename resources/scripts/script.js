const serialDevice = new StmDevice();

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let message_buffer = "";

// [DEV NOTE]: Execute this function directly in the chrome console to test
// receiving data without needing to connect a device.
async function handleReceivedData(data) {
  console.log(data);

  if (data.includes("\x07")) {
    console.error("Serial responded with an error response!");
    message_buffer = "";
    return;
  }

  message_buffer += data;
  let end_of_command = message_buffer.indexOf("\r");

  // Keep parsing out data until the message buffer is empty
  while (end_of_command != -1) {
    let current_command = message_buffer.substring(0, end_of_command + 1);
    message_buffer = message_buffer.substring(end_of_command + 2);
    updateTable({ data: current_command, outgoing: false });
    end_of_command = message_buffer.indexOf("\r");
  }
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
  serialDevice.onConnect(async () => {
    try {
      serialDevice.error = null;
      const close_button = document.querySelector("#close-programming-modal");
      close_button.setAttribute("disabled", true);
      close_button.classList.replace("btn-primary", "btn-secondary");
      document.querySelector(
        "#program-status-message"
      ).innerText = 'Flashing latest firmware. Please wait...';
      document.querySelector("#connect-btn").innerText = "Disconnect";
      document
        .querySelector("#connect-btn")
        .classList.replace("btn-success", "btn-danger");

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
      document.querySelector("#flash-elements").removeAttribute("hidden");
      document.querySelector("#instructions").innerText = "Select which supported firmware to use and click Program Device."
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
    document.querySelector("#flash-elements").setAttribute("hidden", true);
    document.querySelector("#instructions").innerText = "To get started, click connect and select your device!"
    if (serialDevice.error) {
      const close_button = document.querySelector("#close-programming-modal");
      document.querySelector(
        "#program-status-message"
      ).innerText = serialDevice.error;
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

  document.querySelector("#upgrade").addEventListener("click", async () => {
    const close_button = document.querySelector("#close-programming-modal");
    const flash_status = document.querySelector(
      "#program-status-message"
    );
    close_button.setAttribute("disabled", true);

    await serialDevice.flash(updateProgressBar);
    if (serialDevice.isConnected()) {
      flash_status.innerText = "Flash complete!";
      close_button.removeAttribute("disabled");
      close_button.classList.replace("btn-secondary", "btn-primary");
    }
  });

  document.querySelector("#close-programming-modal").addEventListener("click", async () => {
    try {
      if (serialDevice.isConnected()) {
        await sleep(300);
        await serialDevice.onConnectCallback();
      }
    }
    catch (error) {
      await serialDevice.disconnect();
    }
  });
});