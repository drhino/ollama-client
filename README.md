<p align="center">
  <a href="#">
    <img alt="..." width="128" height="128" src="./ollama-v8-framed.svg">
    <h1 align="center">Ollama V8</h1>
  </a>
</p>

# ollama-client
Ollama API client in ECMAScript / JavaScript / ESM.

> I'm probably writing the missing docs whilst you are reading this. \
> Some parts of the code are still being tested and modifed. \
> However, the signatures/methods defined here should/will not change. \
> It's perfectly fine to start using the library. \
> Updates will follow asap.

This library performs extensive validation so you don't need to worry about it. \
Hence, you do not need to validate or typescript any arguments in your app. You can just pass them along and catch the {Error}.

The goal is to provide a client that can grow along with the development of Ollama. And to provide an interface that does not break between versions.
Therefor, unless absolutely necessary, the signatures of the methods will not change (but additional arguments could be added).

No compilation required. \
No external dependencies.

# Usage.

> This documentation is meant for beginning to advanced users. \
> If you have a basic understanding of JavaScript, you should be able to perform any of these steps. \
> Advanced users can ignore the extensive comments.

## Install the library:

... (todo: publish to npm registry) \
Or clone the repo 🤷‍♂️

The files can be imported as-is (even in the browser). But you probably want to minify it for production. \
... (todo: provide minified module)

## Import the library:

> Import the module in your flavor of choice (node, workers, deno, ... anything that's V8 or JavaScript should simply work):
```js
import Ollama from './OllamaRequest.js'

const ollama = new Ollama('http://127.0.0.1:11434')
```
> Or in the browser:
```html
<!-- Option(1): write your app in the html: -->
<script type="module">
  // You can call `Ollama` whatever you like
  import Ollama from './OllamaRequest.js'

  // Note that we're using lowercase for the variable and capitalize the class name
  // `ollama` !== `Ollama`
  const ollama = new Ollama('http://127.0.0.1:11434')
</script>

<!-- Option(2): use a file: -->
<script type="module" src="/path/to/your-app.mjs"></script>
```
> If your using browser modules, you don't need to `document.onload` since modules are deferred by default. \
> This also means you can put the script tag in the `<head>` or `<body>`, it doesn't matter.

> The reason you want to use a module is because modules are scoped. This means they don't expose anything to the `window`.

# API.

## Send a question / generate a response:
Signature:
> (beginners can ignore these, they are helpful for intermediate to advanced users)
```js
ollama.generate(body: object, fn: ?function): Promise<object>
```
Finally, here comes the fun part.
```js
// Uses the *exact* same pattern as the request body
const body = {
  // The following two are *required*
  model: "llama2",
  prompt: "Can we make sausages from lama's?",
}

// Returns a {Promise} that resolves to an {object} holding the final result
// Rejects with an {Error} on failure
const result = await ollama.generate(body)

console.log(result)
/*
{
  context: [1, 13, …],
  created_at: "2023-08-12T14:46:05.229051Z",
  done: true,
  eval_count: 206,
  eval_duration: 15517845000,
  load_duration: 4246692083,
  model: "llama2",
  prompt_eval_count: 158,
  sample_count: 207,
  sample_duration: 769265000,
  total_duration: 25354838000,
  prompt_eval_duration: 4760277000,
  buffers: [ {…}, {…}, … ],
  response: "Thank you for asking! …",
  toString: () => response,
  tokens_per_second: 1.3275039156532366e-8,
}
*/
```
> Alternative approach:
```js
ollama.generate(body).then(result => console.log(result))
```
> Handle errors:
```js
// You can add a `.catch()` to the {Promise}
ollama.generate(body).catch(error => console.error(error))

// Or you can try/catch
try {
  await ollama.generate(body)
} catch (error) {
  console.error(error)
}

// NOTE: `.catch()` takes precedence over try/catch
// However, if you use try/catch you need to `await`
```
This is the really fun part.
```js
// Handle the tokens realtime (by adding a callable/function as the 2nd argument):
const result = await ollama.generate(body, obj => {
  // { model: string, created_at: string, done: false, response: string }
  console.log(obj)

  // NOTE: the last item is different from the above
  // the `done` key is set to `true` and the `response` key is not set
  // The last item holds additional info about the generated response
  // If you're working with the resolved `result`, you may chose to ignore this last item

  // The newly received token
  // This is the result that you want to append to the current state
  const { response } = obj

  // Hence, you probably want to do something like this:
  document.getElementById('response').textContent += response ?? ''
  // NOTE: without the `?? ''` the last item would add 'undefined' (as a literal string) to the result
})

// `result` still holds the final result
// but a callback can be used to display the tokens as they are generated (shown above)
// this offers a `Chat-GPT` like experience where you can see the words appear

// `result` is different from the last item in the callback
// - It adds `buffers`, which is an array of all items except the last one (each of the `obj` above)
// - It also add `response`, which holds the concatenated tokens (each of `obj.response` above)
//   (+ adds a `.toString()` method that returns the value of `response`)
// - Finally, the `tokens_per_second` is precalculated for you 
```
A copy-paste example:
```html
<pre id="response"><!-- words will magically appear here --></pre>

<script type="module">
import Ollama from './OllamaRequest.js'

const ollama = new Ollama('http://127.0.0.1:11434')

const el = document.getElementById('response')

const generate = async(body) => {
  try {
    const result = await ollama.generate(body, obj => {
      // Append to view
      el.textContent += obj.response ?? ''
    })

    // Store the response or display the statistics  
    console.log(result)
  }
  catch (e) {
    // Handle the error
    console.error('Failed to generate result', e)
  }
}

// Executes when the page loads
generate({
  model: "llama2",
  prompt: "Hi!",
})
</script>
```
> Save the file above as `index.html`, start a simple webserver and run it. \
> Make sure to check your console for any errors. \
> Any webserver will work (it only needs to be able to serve static files). \
> An example on how to start a very simple http server using python: \
> $ python3 -m http.server --bind 127.0.0.1 11435 \
> Run the command above in the directory you placed the `index.html` file. \
> Then point your browser to: http://127.0.0.1:11435 \
> Make sure the Ollama server is running.

Additional options can be added to the `body` argument:
```js
const body = {
  // Required:
  model: "llama2",
  prompt: "Hi!",

  // Optional:
  options: {
    // Any of the available options of a `Modelfile`
    temperature: 1,
  },
  system: "...", // overrides the system template
  template: "..." // overrides the model template
}
```

... \
... \
... \
Yes indeed... there's still much work to do here. \
But hey, thanks for reading. Go build something awesome!
