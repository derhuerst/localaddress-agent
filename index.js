import createAgent from 'agent-base'
import {connect as netConnect} from 'net'
import {connect as tlsConnect} from 'tls'
import {createIpPool} from './lib/ip-pool.js'

const SECOND = 1000
const MINUTE = 60 * SECOND

// todo: is there a way to determine the default network interface?

const createIpPoolLocalAddressAgent = async (ipAddresses, iface, opt = {}) => {
	const poolCfg = {
		useExistingAddresses: true,
		addressAssignTimeout: SECOND,
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
		}

		const socket = options.secureEndpoint
			? tlsConnect(options)
			: netConnect(options)
		// todo: release address after request is done!

		return socket
	}

	return createAgent(createSocketWithLocalAddressFromIpPool)
}

export {
	createIpPoolLocalAddressAgent as createIpPoolAgent,
}
