import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { windowsProxyOptions, proxyDispatcher } from "../lib/proxy.js";

test("Windows HTTP/HTTPS proxy settings are parsed without changing global settings; loopback bypasses proxies", async () => {
  assert.equal(
    windowsProxyOptions({ enabled: 0, server: "127.0.0.1:7890" }),
    undefined,
  );
  assert.deepEqual(
    windowsProxyOptions({
      enabled: 1,
      server: "127.0.0.1:7890",
      bypass: "<local>;*.internal.test",
    }),
    {
      httpProxy: "http://127.0.0.1:7890/",
      httpsProxy: "http://127.0.0.1:7890/",
      noProxy: "*.internal.test",
    },
  );
  assert.deepEqual(
    windowsProxyOptions({
      enabled: 1,
      server: "http=127.0.0.1:7890;https=127.0.0.1:7891",
    }),
    {
      httpProxy: "http://127.0.0.1:7890/",
      httpsProxy: "http://127.0.0.1:7891/",
      noProxy: "",
    },
  );
  assert.equal(await proxyDispatcher("http://127.0.0.1:18082"), undefined);
});

test("a real child process routes catalog requests through its configured proxy", async (t) => {
  let target, incoming;
  const proxy = createServer((request, response) => {
    target = request.headers.host;
    incoming =
      request.method +
      " " +
      request.url +
      " HTTP/1.1\r\n" +
      request.rawHeaders.join(":");
    response.end("proxied");
  });
  proxy.on("connect", (request, socket) => {
    target = request.url;
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", (bytes) => {
      incoming = bytes.toString();
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied",
      );
    });
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  t.after(() => {
    proxy.close();
    proxy.closeAllConnections();
  });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(http_proxy|https_proxy|all_proxy|no_proxy|node_use_env_proxy)$/i.test(
          key,
        ),
    ),
  );
  env.HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  const code = `import {fetchBytes} from './lib/network.js';import {closeProxy} from './lib/proxy.js';try{const bytes=await fetchBytes('http://catalog.proxy-test.invalid/install',{origins:['http://catalog.proxy-test.invalid'],downloadHosts:[],timeoutMs:5000,maxArchiveBytes:1024},AbortSignal.timeout(7000),false);console.log(bytes.toString());}finally{await closeProxy();}`;
  const result = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      env,
      cwd: new URL("..", import.meta.url),
      timeout: 10000,
      windowsHide: true,
    },
  );
  assert.equal(result.stdout.trim(), "proxied");
  assert.ok(
    ["catalog.proxy-test.invalid", "catalog.proxy-test.invalid:80"].includes(
      target,
    ),
  );
  assert.match(
    incoming,
    /^GET (?:http:\/\/catalog\.proxy-test\.invalid)?\/install HTTP\/1.1/,
  );
  assert.doesNotMatch(incoming, /(?:authorization|payment-proof|cookie):/i);
});
