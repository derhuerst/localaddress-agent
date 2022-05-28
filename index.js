import createDebug from 'debug'
import createAgent from 'agent-base'
import {connect as netConnect} from 'net'
import {connect as tlsConnect} from 'tls'
import {createIpPool} from './lib/ip-pool.js'

const SECOND = 1000
const MINUTE = 60 * SECOND

const debugConnect = createDebug('ip-range-localaddress-agent:connect')

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
		const localAddress = await ipPool.acquire().promise
		options = {
			...options,
			localAddress,
			// Version of IP stack. Must be 4, 6, or 0. The value 0 indicates that both IPv4 and IPv6 addresses are allowed.
			family: 0,
		}
		debugConnect(options)

		const socket = options.secureEndpoint
			? tlsConnect(options)
			: netConnect(options)

		socket.once('close', () => {
			ipPool.release(localAddress)
		})

		return socket
	}

	const close = () => {
		ipPool.destroy()
	}

	const agent = createAgent(createSocketWithLocalAddressFromIpPool)
	agent.close = close
	return agent
}

export {
	createIpPoolLocalAddressAgent as createIpPoolAgent,
}
