import createDebug from 'debug'
import {isIPv6, isIPv4} from 'net'
import _ipAddress from 'ip-address'
const {Address6, Address4} = _ipAddress
import _netlink from 'netlink'
const {createRtNetlink, rt} = _netlink
import {strictEqual, ok} from 'assert'
import {createPool} from 'generic-pool'
import process from 'node:process'
import {EventEmitter} from 'events'

const DESTROY = Symbol('destroy')

const debug = createDebug('ip-range-localaddress-agent:ip-pool')

const parseAddress = (addr) => {
	// Node.js' isIPv{4,6} don't support netmask, so we cheat here
	const withoutMask = addr.replace(/\/\d{1,3}$/g, '')

	let address,  netlinkEncoded
	if (isIPv6(withoutMask)) {
		const parsed = new Address6(addr)
		address = parsed.addressMinusSuffix
		netlinkEncoded = {
			family: 10,
			address: Buffer.from(parsed.toUnsignedByteArray()),
			prefixlen: parsed.subnetMask,
		}
	} else if (isIPv4(withoutMask)) {
		const parsed = new Address4(addr)
		address = parsed.addressMinusSuffix
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
const addAddress = async (rtNetlink, encodedAddr, interfaceIdx, addrChanges) => {
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

	// bind()-ing to the address *now* fails with EADDRNOTAVAIL, so we listen for `ip monitor` output.
	// todo: find out why this is necessary?
	debug('waiting until address is not tentative anymore', family, address, prefixlen)
	await new Promise((resolve, reject) => {
		const addrWithMask = address.toString('hex') + '/' + prefixlen

		const onAddrChange = (tentative) => {
			// I *assume* that this flag can tell us if we can bind to an address.
			if (tentative) return;
			debug('address is not tentative anymore!', family, address, prefixlen)

			addrChanges.removeListener(addrWithMask, onAddrChange)
			resolve()
		}

		addrChanges.on(addrWithMask, onAddrChange)
		const abort = () => {
			addrChanges.removeListener(addrWithMask, onAddrChange)
			const err = new Error('timeout waiting for IP address to be assigned')
			err.address = address
			err.family = family
			reject(err)
		}
		setTimeout(abort, 5 * 1000)
	})
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

	const addrChanges = new EventEmitter()

	const rtNetlinkSocket = createRtNetlink({ref: false})

	const IPV6 = 10
	rtNetlinkSocket.socket.addMembership(rt.MulticastGroups.IPV6_IFADDR)
	rtNetlinkSocket.on('message', message => {
		for (const {kind, data, attrs} of message) {
			if (kind !== 'address') continue
			if (data.family !== IPV6) continue
			if (data.index !== ifaceIdx) continue

			const addrWithMask = attrs.address.toString('hex') + '/' + data.prefixlen
			// todo: there also is attrs.flags
			addrChanges.emit(addrWithMask, !!data.flags?.tentative)
		}
	})

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
		addressAssignTimeout,
		addressRemoveTimeout,
		minAddresses,
		maxAddresses,
		addressMaxIdleTime,
		removeAddressesEvery,
	} = cfg
	strictEqual(typeof useExistingAddresses, 'boolean', 'cfg.useExistingAddresses')
	strictEqual(typeof addressAssignTimeout, 'number', 'cfg.addressAssignTimeout')
	strictEqual(typeof addressRemoveTimeout, 'number', 'cfg.addressRemoveTimeout')
	ok(Number.isInteger(minAddresses), 'cfg.minAddresses')
	ok(Number.isInteger(maxAddresses), 'cfg.maxAddresses')
	strictEqual(typeof addressMaxIdleTime, 'number', 'cfg.addressMaxIdleTime')
	strictEqual(typeof removeAddressesEvery, 'number', 'cfg.removeAddressesEvery')

	const addresses = new Map() // formatted address -> netlink-encoded address

	// todo: keep track of assigned IPs? or fail if already assigned?
	// todo: keep stats on add/delete latencies

	const create = async () => {
		const {done, value: _addr} = await ipAddressesIterator.next()
		if (done) throw new Error('ipAddresses iterator ended, cannot assign a new IP addresss')

		const {address, netlinkEncoded} = parseAddress(_addr)
		try {
			await addAddress(rtNetlinkSocket, netlinkEncoded, ifaceIdx, addrChanges)
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

		try {
			await deleteAddress(rtNetlinkSocket, netlinkEncoded, ifaceIdx)
		} catch (err) {
			if (err && !/\bEADDRNOTAVAIL\b/.test(err.message)) throw err
		}
	}

	const pool = createPool({
		create,
		// todo: validate?
		destroy,
	}, {
		// These `min` addresses will not be assigned up front, but only as soon as they're required.
		// Later, there will always be at least `min` addresses.
		min: minAddresses,
		max: maxAddresses,

		// todo: acquireTimeoutMillis?
		acquireTimeoutMillis: addressAssignTimeout,
		destroyTimeoutMillis: addressRemoveTimeout,
		idleTimeoutMillis: addressMaxIdleTime,
		evictionRunIntervalMillis: removeAddressesEvery,
	})

	let destroyed = false
	const close = async () => {
		if (destroyed) return;
		destroyed = true

		rtNetlinkSocket.socket.close()

		debug('draining addresses from the pool', {
			numUsed: pool.borrowed,
			numFree: pool.available,
			numPending: pool.pending,
		})
		try {
			await pool.drain()
			await pool.clear()
		} catch (err) {
			debug('failed to drain/clear the pool:', err)
			throw err
		}
	}

	pool[DESTROY] = close
	return pool
}

export {
	createIpPool,
	DESTROY,
}
