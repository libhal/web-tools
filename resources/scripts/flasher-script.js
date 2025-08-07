const serialDevice = new StmDevice();

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let message_buffer = "";

serialDevice.onData(handleReceivedData);

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

function resetModal() {
  const close_button = document.querySelector("#close-programming-modal");
  document.querySelector(
    "#program-status-message"
  ).innerText = 'Please select a device...';
}

document.addEventListener("DOMContentLoaded", () => {
  serialDevice.onConnect(async () => {
    try {
      const close_button = document.querySelector("#close-programming-modal");
      close_button.setAttribute('disabled', true);
      close_button.classList.replace("btn-primary", "btn-secondary");
      serialDevice.error = null;
      resetModal();
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

      const flash_status = document.querySelector(
        "#program-status-message"
      );
      close_button.setAttribute("disabled", true);

      await serialDevice.flash(updateProgressBar);
      if (serialDevice.isConnected()) {
        document.querySelector("#flash-progress").style.width = '0%';
        await sleep(200);

        close_button.removeAttribute("disabled");
        close_button.classList.replace("btn-secondary", "btn-primary");
        serialDevice.disconnect();
      }

    } catch (error) {
      console.error(error);
      await serialDevice.disconnect();
    }
  });

  serialDevice.onDisconnect(() => {
    console.log("Disconnected event called!");
    if (serialDevice.error) {
      const close_button = document.querySelector("#close-programming-modal");
      document.querySelector(
        "#program-status-message"
      ).innerText = serialDevice.error;
      close_button.removeAttribute("disabled");
      close_button.classList.replace("btn-secondary", "btn-primary");
    }
  });

  document.getElementById("connect-btn").addEventListener("click", async () => {
    var firmware_type = document.getElementById("firmware-select");
    if (firmware_type.value != "../resources/binaries/DAP103-stlink.bin") {
      if (!serialDevice.isConnected()) {
        serialDevice.connect();
      } else {
        serialDevice.disconnect();
      }
    }
  });

  document.getElementById("firmware-select").addEventListener("change", () => {
    var firmware_type = document.getElementById("firmware-select");
    if (firmware_type.value == "../resources/binaries/DAP103-stlink.bin") {
      document.getElementById("connect-btn").setAttribute("data-bs-target", "#license-modal");
    }
    else {
      document.getElementById("connect-btn").setAttribute("data-bs-target", "#program-modal");
    }
  });

  document.querySelector("#close-programming-modal").addEventListener("click", async () => {
    resetModal();
  });

  document.getElementById("agree-button").addEventListener("click", async () => {
    if (!serialDevice.isConnected()) {
      serialDevice.connect();
    } else {
      serialDevice.disconnect();
    }
  });

  document.getElementById("disagree-button").addEventListener("click", async () => {
    throw new Error("Please agree to license agreement to use CMSIS-DAP firmware.");
  });
});