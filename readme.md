# ip-range-localaddress-agent

**[Node.js HTTP Agent](https://nodejs.org/api/http.html#class-httpagent) to use IP addresses from a range for outgoing requests.** Currently only Linux is supported!

[![npm version](https://img.shields.io/npm/v/ip-range-localaddress-agent.svg)](https://www.npmjs.com/package/ip-range-localaddress-agent)
![ISC-licensed](https://img.shields.io/github/license/derhuerst/ip-range-localaddress-agent.svg)
![minimum Node.js version](https://img.shields.io/node/v/ip-range-localaddress-agent.svg)
[![support me via GitHub Sponsors](https://img.shields.io/badge/support%20me-donate-fa7664.svg)](https://github.com/sponsors/derhuerst)
[![chat with me on Twitter](https://img.shields.io/badge/chat%20with%20me-on%20Twitter-1da1f2.svg)](https://twitter.com/derhuerst)

Do you have a large number of IP addresses (e.g. a `/64` IPv6 range assigned to your [VPS](https://en.wikipedia.org/wiki/Virtual_private_server)) that you would like to use for outgoing requests? Assigning *all* of them to your network interface *up front* is not viable, as there are just too many; Assigning them in batches periodically is a bit unreliable as well, as you will have to coordinate the switch from one batch to another.

This package on the other hand

1. lets you specify a range (or an [iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols), if you want more control) of IP addresses,
2. always keeps a configurable number of IP addresses assigned to the network interface,
3. removes them once they have been used often enough (once by default).

To assign & remove addresses from the network interfaces efficiently, this package uses the [rtnetlink API](https://www.man7.org/linux/man-pages/man7/rtnetlink.7.html) via the [awesome `netlink`](https://github.com/mildsunrise/node_netlink) npm package.


## Installation

```shell
npm install ip-range-localaddress-agent
```


## Usage

```js
import {createIpPoolAgent} from 'ip-range-localaddress-agent'
import http from 'http'

// endlessly cycle 30 IPv6 addresses
const ipAddresses = (function* () {
	let i = 0
	while (true) {
		yield `fe80::dead:beef:${i.toString(16)}/64`
		i = ++i % 30
	}
})()

const agent = createIpPoolAgent(ipAddresses, 'enp0s8')

// send a lot of requests, with changing local addresses
for (let i = 0; i < 100; i++) {
	http.get('http://example.org/', {
		agent,
	}, cb)
}
```


## API

### `createIpPoolAgent(ipAddresses, interface, opt = {})`

`ipAddresses` must be an [iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) or [async iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols).

`interface` must be the name of a network interface (e.g. `eth0`) or its index.

Entries in `opt` override the following defaults:

- `useExistingAddresses` – Use addresses defined in `ipAddresses` if they are assigned to the network interface *already*? Default: `true`
- `addressAssignTimeout` – Timeout for assigning an IP address to the network interface. Default: 1s
- `addressRemoveTimeout` – Timeout for removing an IP address from the network interface. Default: 1s
- `addressMaxIdleTime` – Time that assigned IP addresses have to be idle (unused) in order to be removed automatically. Default: 10m
- `removeAddressesEvery` – How often to check for "stale" idle IP addresses. Default: 10s


### Related

- [`netlink` npm package](https://github.com/mildsunrise/node_netlink) – netlink & rtnetlink client
- [`k13-engineering/node-rtnetlink`](https://github.com/k13-engineering/node-rtnetlink) – alternative to `netlink`
- [C code from the Avahi project adding an address via rtnetlink](https://stackoverflow.com/a/14657883)


## Contributing

If you have a question or need support using `ip-range-localaddress-agent`, please double-check your code and setup first. If you think you have found a bug or want to propose a feature, use [the issues page](https://github.com/derhuerst/ip-range-localaddress-agent/issues).
