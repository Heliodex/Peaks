import { defineEnvVars } from "@sveltejs/kit/env"

export const variables = defineEnvVars({
	LAPSE_CLIENT_ID: {
		description: "OAuth client ID for Lapse",
	},
	LAPSE_CLIENT_SECRET: {
		description: "OAuth client secret for Lapse",
	},
	LAPSE_REDIRECT_URI: {
		description: "OAuth redirect URI for the Lapse callback",
	},
})
