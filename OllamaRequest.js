/** @author git:drhino */
/** @version 0.0.1 */

import { isString, isObject, isRegistryModel, normalizeModelName } from './validate.js'

/** @var ?AbortController */
let abortController

/**
 * Parses the buffer of a stream response.
 *
 * @param {Uint8Array} value
 *
 * @return {Array} Each item in the array is the contents of a new line.
 */
const parse = value => new TextDecoder().decode(value).trim().split(/\r?\n/)

/**
 * OllamaRequest.
 */
export default class {
	/** @var {string} Prefix of endpoints */
	#url

	/** @var ?array */
	#localModelsCache

	/** @var {bool} Whether `watch()` is running */
	#watching = false

	/** @var ?bool Indicates the server status if #watching */
	#online

	/** @var ?AbortController */
	#listModelsAbortController

	/**
	 * @param {string} url e.g: 'http://localhost:11434'.
	 *
	 * @throws {Error} when the given url is invalid.
	 */
	constructor(url) {
		// Validates the input
		url = new URL(url).toString()

		// Removes the trailing slash (if any)
		if (url[url.length - 1] === '/') {
			url = url.substr(0, url.length - 1)
		}

		this.#url = url
	}

	/**
	 * Returns the URL that was defined in the constructor.
	 *
	 * @return {string} url
	 */
	get url() {
		return this.#url
	}

	/**
	 * Cancels the request.
	 *
	 * @return {undefined}
	 */
	stop() {
		abortController?.abort()
		this.#listModelsAbortController?.abort()
	}

	/**
	 * Returns whether the server is running.
	 *
	 * @param {int} timeout in seconds. Defaults to 7.
	 *
	 * @return {bool}
	 */
	async ping(timeout) {
		let response

		timeout = (timeout ?? 7) * 1000

		try {
			response = await fetch(this.#url, { cache: 'no-store', /* signal timeout */ })
		} catch (e) {
			// console.error('Ping Warning (suppressed)', e)
			return false
		}

		if (response.status !== 200) {
			console.error('Ping Warning (suppressed)', 'The server responded with status', response.status)
			return false
		}

		const responseBody = await response.text()

		if (responseBody !== 'Ollama is running') {
			console.error('Ping Warning (suppressed)', 'The server responded with body', responseBody)
			return false
		}

		return true
	}

	/**
	 * Runs a background task that checks whether the server is running.
	 *
	 * Calls `online` and `offline` accordingly.
	 *
	 * @param {int} seconds to wait between intervals. Defaults to 3.
	 *
	 * @return {undefined}
	 */
	watch(interval) {
		// The delay between executions
		interval = (interval ?? 3) * 1000

		this.#watching = true

		const watcher = async() => {
			// Stops the process when the handler was unset in the setTimeout()
			if ( ! this.#watching ) return

			const current = await this.ping()

			if (current !== this.#online) {
				this.#online = current

				if (current) {
					await this.ononline()
				} else {
					await this.onoffline('Server not running')
				}
			}

			// Stops when the handler is unset whilst processing a request
			if (this.#watching) setTimeout(watcher, interval)
		}

		watcher()
	}

	/**
	 * Stops the background task that checks if the server is running.
	 *
	 * Stops the execution but does not abort any processing request.
	 *
	 * @return {undefined}
	 */
	ignore() {
		this.#watching = false
	}

	/**
	 * Event.
	 *
	 * @return {undefined}
	 */
	ononline = () => {}
	// ^ supports async

	/**
	 * Event.
	 *
	 * @param {string} reason 'Server not running'|'Client disconnected'
	 *
	 * @return {undefined}
	 */
	onoffline = reason => {}
	// ^ supports async

	/**
	 * Sends a prompt to the ollama server and handles the response.
	 *
	 * @param {object}    body The json request body to send to the server.
	 * @param {?function} fn   An optional callable to execute on the stream.
	 *
	 * @throws {Error}
	 *
	 * @return {Promise<object>}
	 *
	 * @see https://github.com/jmorganca/ollama/blob/main/docs/api.md#generate-a-completion
	 */
	async generate(body, fn) {
		isObject({ body })

		const allowedKeys = ['model', 'prompt', 'options', 'system', 'template']
		const unknownKey = Object.keys(body).find(x => ! allowedKeys.includes(x))

		if (unknownKey) {
			throw new Error('The key: ' + unknownKey + ' has no effect')
		}

		let { model, prompt, options, system, template } = body

		// Converts to lowercase and adds ':latest', if no tag is given
		model = normalizeModelName({ model }).join(':')

/// ... ??
		await this.#isLocalModel({ model })
		isString({ prompt })

		options  && isObject({ options }) // ... @TODO: validate | all options ?
		system   && isString({ system })
		template && isString({ template })

		if (fn && typeof fn !== 'function') {
			throw new Error('Fn is not a function')
		}

		let statistics, response = '', buffers = []

		await this.#stream(
			'/api/generate',
			// Required: { model: string, prompt: string }
			// Optional: { options: object, system: string, template: string }
			//  Example: { options: { temperature: 1, } }
			//     NOTE: Both `system` and `template` override the Modelfile
			body,
			{ done: true },
			/** @var {object} */
			json => {
				if (json.response) {
					// model: string
					// created_at: string
					// done: FALSE
					// ---
					// response: string
					response += json.response // builds the final result
					buffers.push(json) // appends each buffer as well
				} else {
					// model: string
					// created_at: string
					// done: TRUE
					// ---
					// total_duration: int
					// load_duration: int
					// sample_count: int
					// sample_duration: int
					// prompt_eval_count: int
					// eval_count: int
					// eval_duration: int
					// context: array[int]
					// ---
					// prompt_eval_duration: int
					// ---
					// NOTE: All durations are returned in nanoseconds.
					statistics = json
					statistics.tokens_per_second = json.eval_count / json.eval_duration // float
				}

				fn && fn(json)
			}
		)

		return {
			...statistics,
			buffers, // array
			response, // string
			toString: () => response
		}
	}

	/**
	 * Create a model from a Modelfile.
	 *
	 * @param {string}    name of the resulting model.
	 * @param {string}    path to Modelfile on the host.
	 * @param {?function} fn   An optional callable to execute on the stream.
	 *
	 * @throws {Error}
	 *
	 * @return {Promise<undefined>}
	 *
	 * @see https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md
	 */
	async createModel(name, path, fn) {
		// The server does not check whether the model already exists
		// The model is simply created/updated to the latest version
		// In this implementation we want to mitigate accidental overwrites
		if (await this.#isLocalModel({ name }, true) === true) {
			throw new Error('Model name: ' + name + ' already exists')
		}

		if (isRegistryModel({ name }, true) === true) {
			throw new Error('Model name: ' + name + ' conflicts with an entry in the global registry')
		}

		isString({ path }) // ... @TODO: validate | proper path validation ? / see flysystem funky space

		this.#localModelsCache = undefined

		await this.#stream('/api/create', { name, path }, { status: 'success' }, json => {
			// Example:
			// {"status":"couldn't open modelfile '/path/to/Modelfile'"}
			// {"error":"failed to open file: open /path/to/Modelfile: no such file or directory"}

			console.log(json)

			fn && fn(json)

			const { error } = json

			if (error) {
				throw new Error(error)
			}
		})
	}

	/**
	 * Update the model that's based on a Modelfile.
	 *
	 * NOTE: Does not check whether the same Modelfile (path) is used.
	 *       The `model` is supposed to exist and will be overwritten.
	 *
	 * @param {string} name of the resulting model.
	 * @param {string} path to Modelfile on the host.
	 *
	 * @throws {Error}
	 *
	 * @return {Promise<undefined>}
	 */
	// ...

	/**
	 * Lists the installed models on the ollama server.
	 *
	 * @throws {Error}
	 *
	 * @return {Promise<array[{ name: string, modified_at: string, size: int }]>}
	 */
	async listModels() {
		/** @var {object|undefined} */
		const { models } = await this.#fetch('GET', '/api/tags')

		if (models) return models

		throw new Error('Unable to retreive models')
	}

	/**
	 * Returns a list of the models that can be downloaded.
	 *
	 * @param {string} model **optional** returns the available versions.
	 *
	 * @return {Promise<array>}
	 */
	/*
	// CORS -_-
	async listAllModels(model) {
		if (model) {
			const response = await fetch('https://registry.ollama.ai/v2/library/' + model + '/tags/list')
			const { tags } = await response.json()
			return tags
		} else {
			const response = await fetch('https://registry.ollama.ai/v2/_catalog')
			const { repositories } = await response.json()
			return repositories
		}
	}
	*/

	/**
	 * Adds an alias to the given model.
	 *
	 * @param {string} source      Model name.
	 * @param {string} destination New alias.
	 *
	 * @throws {Error}
	 *
	 * @return {Promise<undefined>}
	 */
	async copyModel(source, destination) {
		await this.#isLocalModel({ source })

		if (await this.#isLocalModel({ destination }, true) === true) {
			throw new Error('Model destination: ' + destination + ' already exists')
		}

		if (isRegistryModel({ destination }, true) === true) {
			throw new Error('Model destination: ' + destination + ' conflicts with an entry in the global registry')
		}

		this.#localModelsCache = undefined

		return this.#fetch('POST', '/api/copy', { source, destination })
	}

	// Rename model ?
	// ...

	/**
	 * Removes a model on the host.
	 *
	 * @param {string} name of the model.
	 *
	 * @return {Promise<undefined>}
	 */
	async deleteModel(model) {
		await this.#isLocalModel({ model })

		this.#localModelsCache = undefined

		return this.#fetch('DELETE', '/api/delete', { model })
	}

	/**
	 * Downloads a model from the ollama registry to the host.
	 *
	 * @param {string} model to download.
	 *
	 * @return {Promise<undefined>}
	 */
	async pullModel(model) {
		isRegistryModel({ model })

		if (await this.#isLocalModel({ model }, true) === true) {
			throw new Error('Model: ' + model + ' is already downloaded')
		}

		this.#localModelsCache = undefined

		/** @var {object} { status: string, digest: string, total: int } */
		return this.#fetch('POST', '/api/pull', { model })
	}

	/**
	 * Generates an embedding from the given prompt using the given model.
	 *
	 * An embedding encodes the given text into an array of tokens (floating points).
	 *
	 * @param {string} model  The model used to generate the embedding.
	 * @param {string} prompt The plain text to encode into an embedding.
	 *
	 * @return {Promise<array[ float ]>}
	 */
	async embedding(model, prompt) {
		await this.#isLocalModel({ model })
		isString({ prompt })

		/** @var {object|undefined} */
		const { embeddings } = await this.#fetch('POST', '/api/embeddings', { model, prompt })

		if (embeddings) return embeddings

		throw new Error('Unable to generate embedding')
	}

	/**
	 * Sends a request to the Ollama server and return the parsed json response.
	 *
	 * @param {string}  method  'GET'|'POST'|'DELETE'.
	 * @param {string}  endpoint The relative URI.
	 * @param {?object} body     Request body for HTTP POST & DELETE.
	 *
	 * @throws {Error|AbortError}
	 *
	 * @return {Promise<object>} json
	 */
	async #fetch(method, endpoint, body) {
		// The server is not designed to handle multiple requests
		if (abortController) {
			throw new Error('Another request is still processing')
		}
	
		abortController = new AbortController

		let error, json

		try {
			/** @var {object|undefined} */
			if (body) {
				// Stringifies the request body
				body = JSON.stringify(body)
			}

			// Sends the request to the server
			const response = await fetch(this.#url + endpoint, {
				method, // string
				body,   // string|undefined
				cache: 'no-store',
				signal: abortController.signal,
			})

			if ( ! response.ok ) {
				// Throws the response body of a failed response (without json decoding)
				let err = `HTTP Error (${response.status}): `
					err += await response.text()

				throw new Error(err)
			}

			json = await response.json()
		} catch (e) {
			error = e
		}

		abortController = undefined

		// Rethrows the error after unlocking
		if (error) {
			throw error
		}

		return json
	}

	/**
	 * Sends a request to the Ollama server and stream the response.
	 *
	 * @param {string}    endpoint The relative URI.
	 * @param {object}    body     Request body for HTTP POST.
	 * @param {object}    expect   Key-value pair at the end of the response.
	 * @param {?function} fn       Callback for each line in the response.
	 *
	 * @throws {Error|AbortError}
	 *
	 * @return {Promise<undefined>}
	 */
	async #stream(endpoint, body, expect, fn) {
		// The server is not designed for handling multiple requests
		if (abortController) {
			throw new Error('Another request is still processing')
		}
	
		abortController = new AbortController

		let error

		try {
			// Sends the request to the server
			const response = await fetch(this.#url + endpoint, {
				method: 'POST',
				body: JSON.stringify(body),
				cache: 'no-store',
				signal: abortController.signal,
			})

			if ( ! response.ok ) {
				// Throws the response body of a failed response (without json decoding)
				let err = `HTTP Error (${response.status}): `
					err += await response.text()

				throw new Error(err)
			}

			const reader = response.body.getReader()

			// The expected key-value pair of the last json sequence
			const [ k, v ] = Object.entries(expect)[0]

			// Reads the stream until we receive the expected above
			loop:
			while (true) {
				const { done, value } = await reader.read()

				// Connection closed by server
				if (done) {
					// We break before reaching here
					throw new Error('Failed to fulfill request')
				}

				// Processes each new line received from the server
				for (let buffer of parse(value)) {
					// Removes the record seperator (if any)
					if (buffer[0] === 0x1E) { // chr(036)
						buffer = buffer.substr(1)
					}

					// RFC compliant
					try {
						// Parses the text buffer into a JSON object
						buffer = JSON.parse(buffer)
					} catch (e) {
						// Should not happen
						console.error('Error: Failed to Parse JSON (suppressed)', e)
						continue
					}

					// Execute the callback and pass the parsed object as an argument
					fn && fn(buffer)

					// The last buffer that we expect
					if (buffer[k] === v) {
						// Breaks out of the while-loop
						break loop
					}
				}
			}
		} catch (e) {
			error = e
		}

		abortController = undefined

		// Rethrows the error after unlocking
		if (error) {
			throw error
		}
	}

	/**
	 * Checks whether the given model name exists on the host.
	 *
	 * @param {object} obj { key: (string) value } model, e.g: 'orca', 'llama2', 'llama2:13b'
	 * @param {bool} asBool Whether to return a boolean rather than throwing an error.
	 *
	 * @throws {Error} when the given model or tag could not be found.
	 *
	 * @return {Promise<undefined|bool>}
	 */
	async #isLocalModel(obj, asBool) {
		isString(obj)

		let [ name, value ] = Object.entries(obj)[0]

		let [ model, tag ] = value.split(':')

		value = model + ':' + (tag ?? 'latest')

		if (this.#localModelsCache?.find(x => x.name === value)) {
			return
		}

		const models = await this.listModels()

		this.#localModelsCache = models

		if (models.find(x => x.name === value) === undefined) {
			if (asBool) {
				return false
			} else {
				name = name[0].toUpperCase() + name.slice(1)
				throw new Error(name + ' does not exist: ' + value)
			}
		}

		if (asBool) {
			return true
		}
	}
}
