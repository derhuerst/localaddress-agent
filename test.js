import createDebug from 'debug'
import {networkInterfaces as osNetworkInterfaces} from 'node:os'
import {execa} from 'execa'
import {test} from 'tape'
import {createIpPool, DESTROY} from './lib/ip-pool.js'

const SECOND = 1000
const MINUTE = 60 * SECOND

const debug = createDebug('localaddress-agent:test')

const IP_NS = Math.round(Math.random() * (16 ** 4 - 1)).toString(16).split('.')[0]
const IP_PREFIX = `fe80::${IP_NS}:`
debug('using IP address prefix', IP_PREFIX)

const ASSIGN_TIMEOUT = 3 * SECOND
const REMOVE_TIMEOUT = 1 * SECOND
const poolDefaults = {
	useExistingAddresses: true,
	addressAssignTimeout: ASSIGN_TIMEOUT,
	addressRemoveTimeout: REMOVE_TIMEOUT,
	addressMaxIdleTime: MINUTE,
	removeAddressesEvery: 15 * SECOND,
}

const ifaces = Object.keys(osNetworkInterfaces())
.filter(iface => !/^lo\d*$/.exec(iface)) // filter out `lo`, `lo0`, etc.
const iface = [
	'eth0', // Debian/Ubuntu default
	'en0', // macOS default
].find(iface => ifaces.includes(iface)) || ifaces[0]
debug('using interface', iface)

const getLinkLocalAddresses = async () => {
	const {stdout} = await execa('ifconfig', [iface])

	const re = `^\\s*inet6\\s+(${IP_PREFIX}[a-z0-9]{0,4})`
	debug('ifconfig stdout:\n', stdout)
	return stdout
	.split('\n')
	.filter(line => new RegExp(re, 'g').exec(line) !== null)
	.map(line => new RegExp(re, 'g').exec(line)?.[1])
	.sort()
}
const getAddresses = async () => {
	return (await getLinkLocalAddresses())
	.filter(addr => addr.startsWith(IP_PREFIX))
}

const pDelay = ms => new Promise(r => setTimeout(r, ms))

test('ip-pool works', async (t) => {
	// endlessly cycle 100 IPv6 addresses
	const ipAddresses = (function* () {
		let i = 0
		while (true) {
			yield IP_PREFIX + i.toString(16) + '/64'
			i = ++i % 100
		}
	})()

	t.deepEqual(await getAddresses(), [], 'should be empty before pool creation')

	const pool = await createIpPool(ipAddresses, iface, {
		...poolDefaults,
		minAddresses: 3,
		maxAddresses: 5,
	})
	await pDelay(ASSIGN_TIMEOUT + 300)

	const expected1 = [
		IP_PREFIX + '0',
		IP_PREFIX + '1',
		IP_PREFIX + '2',
	]
	debug('expected1', expected1)
	t.deepEqual(await getAddresses(), expected1, 'should be filled after pool creation + delay')

	const acquired1 = await pool.acquire()
	await pool.destroy(acquired1)
	await pDelay(ASSIGN_TIMEOUT + 300)
	const expected2 = [...expected1, IP_PREFIX + '3'].filter(ip => ip !== acquired1.address)
	debug('expected2', expected2)
	t.deepEqual(await getAddresses(), expected2, 'should be filled after 1st ip acquire() & destroy()')

	const acquired2 = await pool.acquire()
	await pool.destroy(acquired2)
	await pDelay(ASSIGN_TIMEOUT + 300)
	const expected3 = [...expected2, IP_PREFIX + '4'].filter(ip => ip !== acquired2.address)
	debug('expected3', expected3)
	t.deepEqual(await getAddresses(), expected3, 'should be filled after 2nd ip acquire() & destroy()')

	await pool[DESTROY]()
	await pDelay(REMOVE_TIMEOUT + 300)
	t.deepEqual(await getAddresses(), [], 'should be empty after pool destruction')
})

// todo: write test for random-from-env.js
