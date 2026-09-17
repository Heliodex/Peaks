# Code style

## JS

- Use tabs for indentation
- Prefer double quotes over single quotes for strings
- Prefer string interpolation over concatenation
- Omit semicolons for separating statements
	- If required, for example where a statement starts with a parenthesis, see if it can be split up with a constant declaration
	- If a IIFE is needed, use `void` instead of a semicolon
- Blocks or conditionals with 1 statement should omit braces
- Arrow functions with only a single return expression should omit braces and the return keyword
- Function declarations should use arrow functions if they have only a single return expression, and standard function declarations otherwise
- Prefer `for (const x of y) ...` over `y.forEach(x => ...)`
- Prefer `const` over `let`
	- Avoid `var`
- Use `===` and `!==` over `==` and `!=`
- Use Object.freeze() to make objects immutable where possible
- Omit `void` before function calls, unless this function call is a IIFE

## TS

- Use return types on functions
- Avoid `any` types

## Svelte

- Use Svelte 5 syntax and runes
- Prefer Svelte's attribute interpolation `"test {x} test"` over standard JS string interpolation `` `test ${x} test` `` where available
- Svelte classes can take an object or array as a value. Prefer this syntax `class={["test", x ? "test2" : "test3"]}` over any kind of string interpolation `class="test {x ? 'test2' : 'test3'}"`
	- There is no need to use single quotes for the class names in the array, as they aren't inside a string interpolation
	- See https://svelte.dev/docs/svelte/class/llms.txt
- Prefer declaration tags `{let x = 5}`, `{const x = 5}` over @const directives `{@const x = 5}`
	- If reactivity is required, use $derived()
	- See https://svelte.dev/docs/svelte/declaration-tags/llms.txt and https://svelte.dev/docs/svelte/@const/llms.txt
- If writing getter and setter functions, see if they can be better served by a reactive class, with $state() fields or get property() & set property() functions

# CSS

- Avoid margins where possible
	- Replace with padding or gaps where spacing is needed
	- Replace with flex or grid for centreing
	- If needing negative margins for funky tricks, OK
