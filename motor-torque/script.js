document.addEventListener("DOMContentLoaded", () => {
  const query_string = window.location.search;
  const base64_url_params = new URLSearchParams(query_string);
  let url_params = new URLSearchParams(query_string);

  const share_link = document.getElementById("share-link");
  const og_title = document.querySelector('meta[property="og:title"]');
  const og_description = document.querySelector(
    'meta[property="og:description"]'
  );
  const og_image = document.querySelector('meta[property="og:image"]');
  const meta_description_tag = document.querySelector(
    'meta[name="description"]'
  );

  if (base64_url_params.has("data")) {
    url_params = new URLSearchParams(atob(base64_url_params.get("data")));

    const description = `Torque curve for ${url_params.get("motor_name")}.
     Link to motor datasheet or purchase site can be found here:
     ${url_params.get("motor_url")}.`;

    meta_description_tag.setAttribute("content", description);
    og_description.setAttribute("content", description);
  }

  let timeout_handle = null;

  document.getElementById("copy-share").onclick = (elem) => {
    navigator.clipboard.writeText(share_link.value);
    elem.currentTarget.innerHTML = "✅";

    if (timeout_handle) {
      clearTimeout(timeout_handle);
    }

    timeout_handle = setTimeout(() => {
      console.log("fire!");
      document.getElementById("copy-share").innerHTML = "📋";
    }, 1000);
  };

  function setup_input_fields(id_name) {
    elem = document.getElementById(id_name);
    if (
      id_name === "motor_name" ||
      id_name === "motor_url" ||
      id_name === "image_link"
    ) {
      elem.addEventListener("input", (e) => {
        url_params.set(id_name, e.currentTarget.value);
        update_meta_data();
        update();
      });
    } else {
      elem.addEventListener("input", (e) => {
        url_params.set(id_name, e.currentTarget.value);
        update_share_link();
        update();
      });
    }
    if (url_params.has(id_name)) {
      console.log(id_name);
      elem.value = url_params.get(id_name);
    }
    return elem;
  }

  const rated_torque_input = setup_input_fields("rated_torque");
  const no_load_speed_input = setup_input_fields("no_load_speed");
  const rated_speed_input = setup_input_fields("rated_speed");
  const no_load_current_input = setup_input_fields("no_load_current");
  const rated_current_input = setup_input_fields("rated_current");
  const current_limit_input = setup_input_fields("current_limit");
  const torque_chart_canvas = setup_input_fields("torque_chart");
  setup_input_fields("motor_name");
  setup_input_fields("motor_url");
  setup_input_fields("image_link");

  let torque_chart = new Chart(torque_chart_canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "RPM",
          data: [],
          borderColor: "rgba(75, 192, 192, 1)",
          yAxisID: "rpm-axis",
          fill: false,
        },
        {
          label: "RPM Limited",
          data: [],
          borderColor: "rgba(255, 99, 132, 1)",
          yAxisID: "rpm-axis",
          fill: false,
        },
        {
          label: "Current",
          data: [],
          borderColor: "rgba(54, 162, 235, 1)",
          yAxisID: "current-axis",
          fill: false,
        },
        {
          label: "Current Limited",
          data: [],
          borderColor: "rgba(255, 206, 86, 1)",
          yAxisID: "current-axis",
          fill: false,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: {
          title: {
            display: true,
            text: "Torque (Nm)",
          },
        },
        "rpm-axis": {
          type: "linear",
          position: "left",
          title: {
            display: true,
            text: "RPM",
          },
        },
        "current-axis": {
          type: "linear",
          position: "right",
          title: {
            display: true,
            text: "Current (Amp)",
          },
        },
      },
    },
  });

  function roundWithPrecision(num, precision) {
    var multiplier = Math.pow(10, precision);
    return Math.round(num * multiplier) / multiplier;
  }

  function update() {
    const rated_torque = parseFloat(rated_torque_input.value);
    const no_load_speed = parseFloat(no_load_speed_input.value);
    const rated_speed = parseFloat(rated_speed_input.value);
    const no_load_current = parseFloat(no_load_current_input.value);
    const rated_current = parseFloat(rated_current_input.value);
    const current_limit = parseFloat(current_limit_input.value);

    let torque_values = [];
    let rpm_values = [];
    let rpm_limited_values = [];
    let current_values = [];
    let current_limited_values = [];

    const rpm_delta = rated_speed - no_load_speed;
    const current_delta = rated_current - no_load_current;
    const rpm_per_torque = rpm_delta / rated_torque;
    const current_per_torque = current_delta / rated_torque;
    const stall_torque = -no_load_speed / rpm_per_torque;

    for (
      let torque_step = 0;
      torque_step <= stall_torque;
      torque_step += stall_torque / 20
    ) {
      const rpm = no_load_speed + rpm_per_torque * torque_step;
      const current = no_load_current + current_per_torque * torque_step;
      rpm_values.push(rpm);
      torque_values.push(roundWithPrecision(torque_step, 6));
      current_values.push(current);

      if (current <= current_limit) {
        rpm_limited_values.push(rpm);
        current_limited_values.push(current);
      } else {
        rpm_limited_values.push(rpm * (current_limit / current));
        current_limited_values.push(current_limit);
      }
    }

    torque_chart.data.labels = torque_values;
    torque_chart.data.datasets[0].data = rpm_values;
    torque_chart.data.datasets[1].data = rpm_limited_values;
    torque_chart.data.datasets[2].data = current_values;
    torque_chart.data.datasets[3].data = current_limited_values;
    torque_chart.update();

    update_table(
      torque_values,
      rpm_values,
      current_values,
      rpm_limited_values,
      current_limited_values
    );
  }

  function update_table(
    torque_values,
    rpm_values,
    current_values,
    rpm_limited_values,
    current_limited_values
  ) {
    const table = document.getElementById("output_table");
    table.innerHTML = "";

    torque_values.forEach((torque, index) => {
      const row = document.createElement("tr");
      [
        torque,
        rpm_values[index],
        rpm_limited_values[index],
        current_values[index],
        current_limited_values[index],
      ].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value.toFixed(2);
        row.appendChild(cell);
      });

      table.appendChild(row);
    });
  }

  function update_share_link() {
    share_link.value =
      window.location.href.split("?")[0] +
      "?data=" +
      btoa(url_params.toString());
  }

  function update_meta_data() {
    const title = `${url_params.get("motor_name")} Torque Curve`;
    const description = `Torque curve for ${url_params.get("motor_name")}.
     Link to motor datasheet or purchase site can be found here:
     ${url_params.get("motor_url")}.`;

    document.title = title;
    og_title.setAttribute("content", title);
    meta_description_tag.setAttribute("content", description);
    og_description.setAttribute("content", description);
    og_image.setAttribute("content", url_params.get("image_url"));

    update_share_link();
  }

  update_meta_data();
  update(); // Initial update
});
