import createDebug from 'debug'
import createAgent from 'agent-base'
import {connect as netConnect} from 'net'
import {connect as tlsConnect} from 'tls'
import {createIpPool, DESTROY} from './lib/ip-pool.js'

const SECOND = 1000
const MINUTE = 60 * SECOND

const debugConnect = createDebug('localaddress-agent:connect')

// todo: is there a way to determine the default network interface?

const createIpPoolLocalAddressAgent = async (ipAddresses, iface, opt = {}) => {
	const poolCfg = {
		useExistingAddresses: true,
		addressAssignTimeout: 3 * SECOND,
		addressRemoveTimeout: SECOND,
		minAddresses: 10,
		maxAddresses: 50,
		addressMaxIdleTime: 10 * MINUTE,
		removeAddressesEvery: 10 * SECOND,
		...opt,
	}
	const ipPool = await createIpPool(ipAddresses, iface, poolCfg)

	const createSocketWithLocalAddressFromIpPool = async (req, options) => {
		const acquired = await ipPool.acquire()
		const {address: localAddress, family} = acquired

		options = {
			...options,
			localAddress,
			// From the Node.js docs:
			// > Version of IP stack. Must be 4, 6, or 0. The value 0 indicates that both IPv4 and IPv6 addresses are allowed.
			// Unfortunately, using IPv6 addresses with `family: 0` doesn't seem to work (Node.js v16.16.0, Linux 5.4.0-121-generic),
			// so we pass `4` or `6`.
			family,
		}
		debugConnect(options)

		const socket = options.secureEndpoint
			? tlsConnect(options)
			: netConnect(options)

		socket.once('close', () => {
			// todo: strategy if/when to destroy
			ipPool.destroy(acquired)
		})

		return socket
	}

	const destroy = async () => {
		await ipPool[DESTROY]()
	}

	const agent = createAgent(createSocketWithLocalAddressFromIpPool)
	agent.destroy = destroy
	return agent
}

export {
	createIpPoolLocalAddressAgent as createIpPoolAgent,
}
