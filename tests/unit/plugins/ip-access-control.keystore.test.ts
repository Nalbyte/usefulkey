import { beforeEach, describe, expect, it } from "vitest";
import { usefulkey } from "../../../src";
import { MemoryKeyStore } from "../../../src/adapters/keystore/memory";
import { ipAccessControlKeystore } from "../../../src/plugins";
import { configureCryptoProvider } from "../../../src/utils/crypto";

beforeEach(() => {
	let seed = 12345;
	const nextByte = () => (seed = (seed * 1664525 + 1013904223) >>> 0) & 0xff;
	configureCryptoProvider({
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) arr[i] = nextByte();
			return arr;
		},
		randomUUID: () => "00000000-0000-4000-8000-000000000000",
	} as any);
});

describe("ipAccessControl keystore plugin", () => {
	it("persists lists and enforces rules", async () => {
		const keyStore = new MemoryKeyStore();
		const uk = usefulkey(
			{ adapters: { keyStore } },
			{
				plugins: [
					ipAccessControlKeystore({ allow: ["1.1.1.1"], deny: ["9.9.9.9"] }),
				],
			},
		);
		const created = await uk.createKey();
		const key = created.result!.key;

		let res = await uk.verifyKey({ key, ip: "9.9.9.9" });
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("ip_denied");

		res = await uk.verifyKey({ key, ip: "5.5.5.5" });
		expect(res.result?.valid).toBe(false);
		expect(res.result?.reason).toBe("ip_not_allowed");

		res = await uk.verifyKey({ key, ip: "1.1.1.1" });
		expect(res.result?.valid).toBe(true);

		await (uk as any).ipAccessControlStore.addAllow("2.2.2.2");
		await (uk as any).ipAccessControlStore.addDeny("3.3.3.3");

		const allow = await (uk as any).ipAccessControlStore.getAllow();
		const deny = await (uk as any).ipAccessControlStore.getDeny();
		expect(allow).toEqual(expect.arrayContaining(["1.1.1.1", "2.2.2.2"]));
		expect(deny).toContain("3.3.3.3");

		const uk2 = usefulkey(
			{ adapters: { keyStore } },
			{ plugins: [ipAccessControlKeystore()] },
		);
		const allow2 = await (uk2 as any).ipAccessControlStore.getAllow();
		const deny2 = await (uk2 as any).ipAccessControlStore.getDeny();
		expect(allow2).toEqual(expect.arrayContaining(["1.1.1.1", "2.2.2.2"]));
		expect(deny2).toContain("3.3.3.3");

		const created2 = await uk2.createKey();
		const key2 = created2.result!.key;
		const denied = await uk2.verifyKey({ key: key2, ip: "3.3.3.3" });
		expect(denied.result?.valid).toBe(false);
		expect(denied.result?.reason).toBe("ip_denied");
	});
});
