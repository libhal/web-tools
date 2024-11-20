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
  close_button.setAttribute("disabled", true);
  close_button.classList.replace("btn-primary", "btn-secondary");
  document.querySelector(
    "#program-status-message"
  ).innerText = 'Flashing latest firmware. Please wait...';
  
}

document.addEventListener("DOMContentLoaded", () => {
  serialDevice.onConnect(async () => {
    try {
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

      const close_button = document.querySelector("#close-programming-modal");
      const flash_status = document.querySelector(
        "#program-status-message"
      );
      close_button.setAttribute("disabled", true);

      await serialDevice.flash(updateProgressBar);
      if (serialDevice.isConnected()) {
        document.querySelector("#flash-progress").style.width='0%';
        await sleep(200);
        flash_status.innerText = "Flash complete! Device is disconnected and ready to use!";
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

  document.querySelector("#connect-btn").addEventListener("click", async () => {
    if (!serialDevice.isConnected()) {
      serialDevice.connect();
    } else {
      serialDevice.disconnect();
    }
  });

  document.querySelector("#close-programming-modal").addEventListener("click", async () => {
    resetModal();
  });
});