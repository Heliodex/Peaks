<script lang="ts">
	import { lapseLogin } from "../(main)/api.remote.js"
</script>

<h1>Peaks</h1>
<p>Log in with your Lapse account to continue.</p>

<form {...lapseLogin}>
	<button type="submit">Log in with Lapse</button>
</form>
