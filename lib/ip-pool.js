import createDebug from 'debug'
import {isIPv6, isIPv4} from 'net'
import _ipAddress from 'ip-address'
const {Address6, Address4} = _ipAddress
import _netlink from 'netlink'
const {createRtNetlink} = _netlink
import {Pool} from 'tarn'
import process from 'node:process'

const SECOND = 1000
const MINUTE = 60 * SECOND

const debug = createDebug('ip-range-localaddress-agent:ip-pool')
const debugTarn = createDebug('ip-range-localaddress-agent:ip-pool:tarn')

const parseAddress = (addr) => {
	let address, netlinkEncoded
	if (isIPv6(addr)) {
		const parsed = new Address6(addr)
		address = parsed.address
		netlinkEncoded = {
			family: 10,
			address: Buffer.from(parsed.toUnsignedByteArray()),
			prefixlen: parsed.subnetMask,
		}
	} else if (isIPv4(addr)) {
		const parsed = new Address4(addr)
		address = parsed.address
		netlinkEncoded = {
			family: 2,
			address: Buffer.from(parsed.toArray()),
			prefixlen: parsed.subnetMask,
		}
	} else {
		throw new Error('invalid/unsupported address: ' + addr)
	}
	return {
		address,
		netlinkEncoded,
	}
}

const getInterfaceIndex = async (rtNetlink, interfaceName) => {
	// todo: find a more efficient way than querying n addresses
	for (const addr of await rtNetlink.getAddresses()) {
		if (addr.attrs && addr.attrs.label === interfaceName) {
			return addr.data.index
		}
	}
	throw new Error(`interface "${interfaceName}} not found via rtnetlink`)
}

// not idempotent, throws "Request rejected: EEXIST"
const addAddress = async (rtNetlink, encodedAddr, interfaceIdx) => {
	const {family, address, prefixlen} = encodedAddr
	const data = {
		family,
		prefixlen,
		index: interfaceIdx,
		// note: these properties have to be present!
		flags: {}, // todo: make configurable?
	}
	const attrs = {
		address,
	}

	debug('adding address', family, address, prefixlen)
	await rtNetlink.newAddress(data, attrs)
}

// not idempotent, throws "Request rejected: EADDRNOTAVAIL"
const deleteAddress = async (rtNetlink, encodedAddr, interfaceIdx) => {
	const {family, address, prefixlen} = encodedAddr
	const data = {
		family,
		prefixlen,
		index: interfaceIdx,
		// note: these properties have to be present!
		flags: {}, // todo: make configurable?
	}
	const attrs = {
		address,
	}

	debug('deleting address', family, address, prefixlen)
	await rtNetlink.delAddress(data, attrs)
}

const createIpPool = async (ipAddresses, _iface, cfg) => {
	let ipAddressesIterator
	if ('function' === typeof ipAddresses[Symbol.iterator]) {
		ipAddressesIterator = ipAddresses[Symbol.iterator]()
	} else  if ('function' === typeof ipAddresses[Symbol.asyncIterator]) {
		ipAddressesIterator = ipAddresses[Symbol.asyncIterator]()
	} else {
		throw new TypeError('ipAddresses must be an iterable or async iterable')
	}

	const rtNetlinkSocket = createRtNetlink()
	// Don't prevent Node.js from exiting if just this connection is left open!
	rtNetlinkSocket.socket.unref()

	let ifaceIdx
	if ('string' === typeof _iface) { // e.g. eth0
		ifaceIdx = await getInterfaceIndex(rtNetlinkSocket, _iface)
	} else if ('number' === typeof _iface) {
		ifaceIdx = _iface
	} else {
		throw new TypeError('_iface must be a string (OS name) or number (OS index)')
	}

	const {
		useExistingAddresses,
	} = cfg

	const addresses = new Map() // formatted address -> netlink-encoded address

	// todo: keep track of assigned IPs? or fail if already assigned?
	// todo: keep stats on add/delete latencies

	const create = async () => {
		const {done, value: _addr} = await ipAddressesIterator.next()
		if (done) throw new Error('ipAddresses iterator ended, cannot assign a new IP addresss')

		const {address, netlinkEncoded} = parseAddress(_addr)
		try {
			await addAddress(rtNetlinkSocket, netlinkEncoded, ifaceIdx)
		} catch (err) {
			if (err.message !== 'Request rejected: EEXIST') throw err
			if (!useExistingAddresses) throw err
		}

		addresses.set(address, netlinkEncoded)
		return address
	}

	const destroy = async (address) => {
		if (!addresses.has(address)) {
			throw new Error(`address ${address} doesn't seem to be in the pool`)
		}
		const netlinkEncoded = addresses.get(address)

		// todo: make this idempotent?
		await deleteAddress(rtNetlinkSocket, netlinkEncoded, ifaceIdx)
	}

	const pool = new Pool({
		create,
		// todo: validate?
		destroy,

		log: (msg, level) => {
			debugTarn(`${level}: ${msg}`)
		},

		// todo: make configurable
		// These `min` addresses will not be assigned up front, but only as soon as they're required.
		// Later, there will always be at least `min` addresses.
		min: 10,
		max: 50,

		// todo: make configurable
		createTimeoutMillis: SECOND,
		destroyTimeoutMillis: SECOND,
		idleTimeoutMillis: 10 * MINUTE,
		reapIntervalMillis: 10 * SECOND,
	})

	if (debugTarn.enabled) {
		pool.on('acquireSuccess', (_, addr) => debugTarn('acquireSuccess', addr))
		pool.on('acquireFail', (_, err) => debugTarn('acquireFail', err))

		pool.on('createSuccess', (_, resource) => debugTarn('createSuccess', resource))
		pool.on('createFail', (_, err) => debugTarn('createFail', err))

		pool.on('release', (addr) => debugTarn('release', addr))

		pool.on('destroySuccess', (_, resource) => debugTarn('destroySuccess', resource))
		pool.on('destroyFail', (_, resource, err) => debugTarn('destroyFail', resource, err))
	}

	pool.on('acquireFail', (_, err) => {
		debug('failed to acquire address', err)
	})
	pool.on('createFail', (_, err) => {
		debug('failed to create/assign address', err)
	})
	pool.on('destroyFail', (_, resource, err) => {
		debug('failed to release/remove address', err)
	})

	pool.on('poolDestroySuccess', () => {
		rtNetlinkSocket.socket.close()
	})

	const onAbortSignal = () => {
		debug('received abort signal, deleting all addresses in the pool', {
			numUsed: pool.numUsed(),
			numFree: pool.numFree(),
		})
		pool.destroy()
		.catch(() => {}) // silence errors
	}
	process.on('SIGINT', onAbortSignal)
	process.on('SIGTERM', onAbortSignal)

	return pool
}

export {
	createIpPool,
}
