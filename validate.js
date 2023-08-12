/** @author git:drhino */
/** @version 0.0.1 */

import { registryModels } from './registryModels.js'

/**
 * Checks whether the given input is a non-empty string.
 *
 * @param {object} obj { key: (string) value }
 *
 * @throws {Error}
 *
 * @return {undefined}
 */
const isString = obj => {
	let [ name, value ] = Object.entries(obj)[0]

	name = name[0].toUpperCase() + name.slice(1)

	if (value === undefined) {
		throw new Error(name + ' is required but undefined')
	}

	if (typeof value !== 'string') {
		throw new Error(name + ' is not a string')
	}

	if (value.trim() === '') {
		throw new Error(name + ' cannot be empty')
	}
}

/**
 * Checks whether the given input is an object.
 *
 * @param {object} obj { key: (object) value }
 *
 * @throws {Error}
 *
 * @return {undefined}
 */
const isObject = obj => {
	let [ name, value ] = Object.entries(obj)[0]

	name = name[0].toUpperCase() + name.slice(1)

	if (value === undefined) {
		throw new Error(name + ' is required but undefined')
	}

	if (typeof value !== 'object') {
		throw new Error(name + ' is not an object')
	}
}

/**
 * Checks whether the given model name is valid.
 *
 * @param {object} obj { key: (string) value } model, e.g: 'orca', 'llama2', 'llama2:13b'
 * @param {bool} asBool Whether to return a boolean rather than throwing an error.
 *
 * @throws {Error} when the given model or tag is invalid.
 *
 * @return {undefined|bool}
 */
const isRegistryModel = (obj, asBool) => {
	const [ model, tag ] = normalizeModelName(obj)

	let [ name, _ ] = Object.entries(obj)[0]

	if (registryModels[model] === undefined) {
		if (asBool) {
			return false
		} else {
			throw new Error('Unknown ' + name + ': ' + model)
		}
	}

	/** @var {bool} */
	// const exists = registryModels[model].includes(tag)
	const exists = !! registryModels[model].find(x => x.toLowerCase() === tag)
	// ^ fixes case-insensitive (#336)

	if (asBool) {
		return exists
	}

	if (exists === false) {
		throw new Error('Unknown version: ' + tag + ' for ' + name + ': ' + model)
	}
}

/**
 * Normalizes a model name.
 *
 * @param {object} obj { key: (string) value } model, e.g: 'orca', 'llama2', 'llama2:13b'
 *
 * @return {array<model: string, tag: string>}
 *
 * @see https://github.com/jmorganca/ollama/issues/336
 */
const normalizeModelName = obj => {
	isString(obj)

	let [ _, value ] = Object.entries(obj)[0]

	value = value.toLowerCase()

	let [ model, tag ] = value.split(':')

	if (tag === undefined) {
		tag = 'latest'

		// Defaults to latest but `latest` is not always available
		// in: "llama-2-13b-chat", "stablebeluga2", "wizardlm"
	}

	return [ model, tag ]
}

export { isString, isObject, isRegistryModel, normalizeModelName }
