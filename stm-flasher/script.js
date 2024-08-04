const stmDevice = new StmDevice();

// functions here
async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resetDevice() {
  await sleep(200);

  await stmDevice.setSignals({
    dataTerminalReady: true,
    requestToSend: false,
  });

  await sleep(200);

  await stmDevice.setSignals({
    dataTerminalReady: false,
    requestToSend: false,
  });

  await sleep(200);
}

async function activateBootloader() {
  await stmDevice.setSignals({
    dataTerminalReady: false, // RESET HIGH
    requestToSend: false, // BOOT HIGH
  });
  await sleep(200);

  await stmDevice.setSignals({
    dataTerminalReady: true, // RESET LOW
    requestToSend: false, // BOOT HIGH
  });
  await sleep(200);

  await stmDevice.setSignals({
    dataTerminalReady: true, // RESET LOW
    requestToSend: true, // BOOT LOW
  });
  await sleep(200);

  await stmDevice.setSignals({
    dataTerminalReady: false, // RESET HIGH
    requestToSend: true, // BOOT LOW
  });
  await sleep(200);

  await stmDevice.setSignals({
    dataTerminalReady: false, // RESET HIGH
    requestToSend: false, // BOOT HIGH
  });
  await sleep(200);
}

document.addEventListener("DOMContentLoaded", () => {
  stmDevice.setBaudRateSourceCallback(() => {
    return "9600";
  });

  stmDevice.onConnect(async () => {
    try {
      document.querySelector("#connect-btn").innerText = "Disconnect";
      document
        .querySelector("#connect-btn")
        .classList.replace("btn-success", "btn-danger");

      console.log("Resetting Device...");
      await resetDevice();

      console.log("Activating bootloader...");
      await activateBootloader();

      console.log("Retrieving device information...");
      await stmDevice.cmdGET();

      await stmDevice.cmdGID();
      document.getElementById("device-info").innerText = `BL version: ${stmDevice.bootLoaderVersion} \nDevice Type: ${stmDevice.deviceType} \nPID: ${stmDevice.pid}`;

      await stmDevice.flash(true);
      console.log("Resetting Device...");
      await resetDevice();
      await sleep(100);
      console.log("Disconnecting...");
      await stmDevice.disconnect();

    } catch (error) {
      console.error(error);
      await stmDevice.disconnect();
    }
  });

  stmDevice.onData(handleReceivedData);

  stmDevice.onDisconnect(() => {
    console.log("Disconnected event called!");
    const connect_btn = document.querySelector("#connect-btn");
    connect_btn.innerText = "Connect";
    connect_btn.classList.replace("btn-danger", "btn-success");
  });

  document.querySelector("#connect-btn").addEventListener("click", async () => {
    if (!stmDevice.isConnected()) {
      stmDevice.connect();
    } else {
      stmDevice.disconnect();
    }
  });

  document.querySelector("#flash-btn").addEventListener("click", async () => {
    if (stmDevice.isConnected()) {
      stmDevice.flash(true);
      await resetDevice();
    } else {
      console.log("Not connected!")
    }
  });

});
