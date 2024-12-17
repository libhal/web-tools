#!/usr/bin/env python

"""
This example shows how sending a single message works.
"""

import time
import can.interfaces.slcan


def send_one():
    """Sends a single message."""

    slcan_device = '/dev/tty.usbserial-58971291291'

    # this uses the default configuration (for example from the config file)
    # see https://python-can.readthedocs.io/en/stable/configuration.html
    bus = can.interfaces.slcan.slcanBus(channel=slcan_device,
                                        ttyBaudrate=115200,
                                        rtscts=True,
                                        bitrate=1000000)
    # print(bus.serialPortOrig.getBaudRate())
    time.sleep(1)
    bus.serialPortOrig.setRTS(False)
    bus.serialPortOrig.setDTR(False)
    time.sleep(1)
    bus.serialPortOrig.write(b"V\r")
    time.sleep(1)
    bus.serialPortOrig.write(b"V\r")
    time.sleep(1)
    bus.serialPortOrig.write(b"V\r")
    time.sleep(1)
    bus.serialPortOrig.write(b"V\r")
    time.sleep(1)
    print(bus.get_serial_number(1))
    time.sleep(1)

    msg = can.Message(arbitration_id=0x141, data=[0xAA, 0xBB, 0xCC])

    try:
        print("Listening for CAN messages on", slcan_device)
        while True:
            try:
                bus.send(msg)
                print(f"Message sent on {bus.channel_info}")
            except can.CanError:
                print("Message NOT sent")

            # Read a message from the CAN bus
            message = bus.recv()

            if message is not None:
                print(f"Received: {message}")

            time.sleep(1)

    except KeyboardInterrupt:
        print("Stopped by user")

    except can.CanError as e:
        print(f"CAN error: {e}")


if __name__ == "__main__":
    send_one()
