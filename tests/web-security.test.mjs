import assert from "node:assert/strict";
import { test } from "node:test";
import { importExtension } from "./harness.mjs";

const { fetchText, isBlockedIp, validateResolvedAddresses } = await importExtension("web-tools.ts");

test("classifica endereços locais e privados como bloqueados", () => {
  const blocked = [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ];
  for (const address of blocked) assert.equal(isBlockedIp(address), true, address);
  assert.equal(isBlockedIp("93.184.216.34"), false);
  assert.equal(isBlockedIp("2606:4700:4700::1111"), false);
});

test("DNS que mistura endereço público e privado falha fechado", () => {
  assert.throws(
    () => validateResolvedAddresses([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /bloqueado/i,
  );
});

test("a própria conexão recusa hostname público resolvido para loopback", async () => {
  const privateResolver = (_hostname, _options, callback) => {
    callback(null, [{ address: "127.0.0.1", family: 4 }]);
  };

  await assert.rejects(
    fetchText(new URL("http://nome-publico.example/"), 1000, undefined, privateResolver),
    /endereço resolvido bloqueado/i,
  );
});
