import _ipAddress from 'ip-address'
const {Address6} = _ipAddress
import {randomBytes} from 'node:crypto'
import {
	strictEqual,
	deepStrictEqual,
	ok,
} from 'node:assert'

const TOTAL_BYTES = 16

const createRandomAddressesGenerator = (ipv6Address, opt = {}) => {
	const range = new Address6(ipv6Address)
	if (!range.parsedSubnet) {
		const err = new Error('the IPv6 address must have a subnet mask')
		err.address = ipv6Address
		throw err
	}

	const {
		getRandomBytes,
	} = {
		getRandomBytes: (bytes) => Array.from(randomBytes(bytes)),
		...opt,
	}

	// todo: make this faster by getting rid of allocations?
	// e.g. using ArrayBuffer, UInt8Array & crypto.getRandomValues()?
	// currently, it can compute about 500k addresses per second

	const prefixNrOfBits = range.subnetMask
	const prefixLastByteIdx = Math.floor(prefixNrOfBits / 8)
	const prefixBytes = range.toUnsignedByteArray().slice(0, prefixLastByteIdx + 1)
	const prefixWholeBytes = prefixBytes.slice(0, -1)
	const prefixNrOfRemainingBits = prefixNrOfBits % 8
	const prefixLastByteMask = 0xff << (8 - prefixNrOfRemainingBits) & 0xff // only first $n bits
	const prefixLastByteMasked = prefixBytes[prefixLastByteIdx] & prefixLastByteMask

	const randomAddressesFromRange = function* () {
		while (true) {
			// `suffixBytes`'s first byte intersects with the last byte of `prefixBytes`
			const suffixBytes = getRandomBytes(TOTAL_BYTES - prefixLastByteIdx)
			const suffixWholeBytes = suffixBytes.slice(1)
			const suffixNrOfRemainingBits = 8 - (prefixNrOfBits % 8)
			const suffixFirstByteMask = (0xff << suffixNrOfRemainingBits) & 0xff ^ 0xff // only last $n bits
			const suffixFirstByteMasked = suffixBytes[0] & suffixFirstByteMask

			const intersectedByte = prefixLastByteMasked | suffixFirstByteMasked
			const addressBytes = [
				...prefixWholeBytes,
				intersectedByte,
				...suffixWholeBytes,
			]
			// yield addressBytes.map(byte => byte.toString(16)).join(':') + range.subnet
			yield Address6.fromUnsignedByteArray(addressBytes).canonicalForm() + range.subnet
		}
	}
	return randomAddressesFromRange
}

{
	let _call = 0
	const getRandomBytes = (bytes) => {
		strictEqual(bytes, 8, 'getRandomBytes() must be called with 8 (bytes)')
		ok(_call < 3, 'getRandomBytes() must only be called 3 times')
		return Buffer.from([
			'1dfb3ce535cbab47',
			'625399ac4be3afcf',
			'2cf8f0008caea9b8',
		][_call++], 'hex')
	}
	const random = createRandomAddressesGenerator('fe80:0102:0203:0304:0405:0506:0607:0708/64', {
		getRandomBytes,
	})

	const r1 = random()
	const r2 = random()
	deepStrictEqual(r1.next(), {
		value: 'fe80:0102:0203:0304:1dfb:3ce5:35cb:ab47/64',
		done: false,
	}, '/64 r1: 1st iteration')
	deepStrictEqual(r2.next(), {
		value: 'fe80:0102:0203:0304:6253:99ac:4be3:afcf/64',
		done: false,
	}, '/64 r2: 1st iteration')
	deepStrictEqual(r1.next(), {
		value: 'fe80:0102:0203:0304:2cf8:f000:8cae:a9b8/64',
		done: false,
	}, '/64 r1: 2nd iteration')
}

{
	const getRandomBytes = () => Buffer.from('abcd', 'hex')
	const random = createRandomAddressesGenerator('fe80:0102:0203:0304:0405:0506:0607:0708/114', {
		getRandomBytes,
	})

	// 0x07 === 0b00000111
	// 0xab === 0b10101011
	// 2 bits + 6 bits
	// 0x2b === 0b00101011
	deepStrictEqual(random().next().value, 'fe80:0102:0203:0304:0405:0506:0607:2bcd/114', '/114')
}

export {
	createRandomAddressesGenerator,
}
