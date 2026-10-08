// Live frame runtime. Runs inside the sandboxed frame; its only channel is postMessage to the parent.
(function () {
  var boot = window.__liveBoot || {};
  var parent = window.parent;
  var listeners = { state: [], theme: [] };
  var state = boot.state && typeof boot.state === "object" ? boot.state : {};
  var theme = boot.theme || null;
  var pending = null;
  var timer = 0;
  function post(message) {
    message.jsonrpc = "2.0";
    parent.postMessage(message, "*");
  }
  function emit(kind, value) {
    listeners[kind].forEach(function (fn) {
      try { fn(value); } catch (error) { console.error(error); }
    });
  }
  function applyTheme(next) {
    if (!next || !next.variables) return;
    theme = next;
    var root = document.documentElement.style;
    Object.keys(next.variables).forEach(function (key) { root.setProperty(key, next.variables[key]); });
    emit("theme", next);
  }
  window.addEventListener("message", function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.jsonrpc !== "2.0") return;
    if (data.method === "ui/notifications/host-context-changed" && data.params) applyTheme(data.params.theme);
    else if (data.method === "paseo/state" && data.params && data.params.state) {
      state = data.params.state;
      emit("state", state);
    } else if (data.result && data.result.hostContext) applyTheme(data.result.hostContext.theme);
  });
  var lastHeight = 0;
  function measure() {
    var height = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    post({ method: "ui/notifications/size-changed", params: { height: height } });
  }
  if (window.ResizeObserver) new ResizeObserver(measure).observe(document.documentElement);
  window.addEventListener("load", measure);

  var live = {
    get state() { return state; },
    get theme() { return theme; },
    /** Merges into the saved state. It persists with the chat and is sent to the agent with the next action. */
    setState: function (patch) {
      state = Object.assign({}, state, patch);
      pending = Object.assign({}, pending || {}, patch);
      emit("state", state);
      clearTimeout(timer);
      timer = setTimeout(function () {
        post({ method: "paseo/state", params: { state: state } });
        pending = null;
      }, 200);
    },
    /** Sends a named action to the agent, which receives it as a widget event (never as typed text). */
    action: function (name, value, patch) {
      var params = { action: String(name) };
      if (value !== undefined) params.value = value;
      if (patch) { state = Object.assign({}, state, patch); params.patch = patch; emit("state", state); }
      post({ method: "ui/message", params: params });
    },
    on: function (kind, fn) {
      listeners[kind].push(fn);
      return function () { listeners[kind] = listeners[kind].filter(function (item) { return item !== fn; }); };
    },
    chart: {}
  };

  // Small SVG charts drawn with the theme colors.
  var ns = "http://www.w3.org/2000/svg";
  function el(name, attrs, parentNode) {
    var node = document.createElementNS(ns, name);
    Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (parentNode) parentNode.appendChild(node);
    return node;
  }
  function frame(target, options, data) {
    var host = typeof target === "string" ? document.querySelector(target) : target;
    var width = options.width || host.clientWidth || 480;
    var height = options.height || 200;
    host.innerHTML = "";
    var svg = el("svg", { class: "chart", viewBox: "0 0 " + width + " " + height, width: "100%", height: height }, host);
    var values = data.map(function (item) { return Number(item.value) || 0; });
    var max = options.max != null ? options.max : Math.max.apply(null, values.concat([0])) || 1;
    return { svg: svg, width: width, height: height, max: max, pad: { t: 10, r: 8, b: 22, l: 8 } };
  }
  function color(index, options) {
    var palette = options.colors || ["var(--accent)", "var(--ring)", "var(--status-success)", "var(--status-warning)", "var(--foreground-muted)"];
    return palette[index % palette.length];
  }
  /** live.chart.bar(target, [{label, value}], {height, max, colors}) */
  live.chart.bar = function (target, data, options) {
    options = options || {};
    var f = frame(target, options, data);
    var inner = f.width - f.pad.l - f.pad.r, h = f.height - f.pad.t - f.pad.b;
    var slot = inner / Math.max(1, data.length), bar = Math.max(4, slot * 0.62);
    el("line", { class: "axis", x1: f.pad.l, x2: f.width - f.pad.r, y1: f.pad.t + h, y2: f.pad.t + h }, f.svg);
    data.forEach(function (item, index) {
      var value = Number(item.value) || 0, barHeight = Math.max(0, (value / f.max) * h);
      var x = f.pad.l + index * slot + (slot - bar) / 2;
      var rect = el("rect", { x: x, y: f.pad.t + h - barHeight, width: bar, height: barHeight, rx: 3, fill: item.color || color(options.colorBy === "index" ? index : 0, options) }, f.svg);
      el("title", {}, rect).textContent = item.label + ": " + value;
      el("text", { x: x + bar / 2, y: f.height - 6, "text-anchor": "middle" }, f.svg).textContent = item.label;
    });
    return f.svg;
  };
  /** live.chart.line(target, [{label, value}], {height, max, area}) */
  live.chart.line = function (target, data, options) {
    options = options || {};
    var f = frame(target, options, data);
    var inner = f.width - f.pad.l - f.pad.r, h = f.height - f.pad.t - f.pad.b;
    var step = inner / Math.max(1, data.length - 1);
    var points = data.map(function (item, index) {
      return [f.pad.l + index * step, f.pad.t + h - ((Number(item.value) || 0) / f.max) * h];
    });
    var path = points.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    el("line", { class: "axis", x1: f.pad.l, x2: f.width - f.pad.r, y1: f.pad.t + h, y2: f.pad.t + h }, f.svg);
    if (options.area !== false && points.length)
      el("path", { d: path + " L" + points[points.length - 1][0] + " " + (f.pad.t + h) + " L" + points[0][0] + " " + (f.pad.t + h) + " Z", fill: color(0, options), opacity: 0.14 }, f.svg);
    el("path", { d: path, fill: "none", stroke: color(0, options), "stroke-width": 2, "stroke-linejoin": "round" }, f.svg);
    data.forEach(function (item, index) {
      if (data.length <= 12 || index % Math.ceil(data.length / 8) === 0)
        el("text", { x: points[index][0], y: f.height - 6, "text-anchor": "middle" }, f.svg).textContent = item.label;
    });
    return f.svg;
  };

  // Preact + htm, plus a hook bound to the saved state.
  var P = window.htmPreact;
  if (P) {
    live.useLive = function () {
      var pair = P.useState(state);
      P.useEffect(function () { return live.on("state", pair[1]); }, []);
      return [pair[0], live.setState];
    };
    live.useTheme = function () {
      var pair = P.useState(theme);
      P.useEffect(function () { return live.on("theme", pair[1]); }, []);
      return pair[0];
    };
    ["html", "render", "h", "Component", "useState", "useEffect", "useMemo", "useRef", "useCallback", "useReducer"].forEach(function (name) {
      if (P[name] && !(name in window)) window[name] = P[name];
    });
  }
  window.live = live;
  if (theme) applyTheme(theme);
  post({ id: 1, method: "ui/initialize", params: { appInfo: { name: "theme-studio-live-kit" } } });
})();
