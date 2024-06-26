import { Client as DiscordClient, GatewayIntentBits, Options } from "discord.js";

import { checkForMigration } from "../db/legacy-migration/migrate.ts";
import { ClientListeners } from "../listeners/client.listeners.ts";
import { ClientUtils } from "../utils/client.utils.ts";
import { ScheduleUtils } from "../utils/schedule.utils.ts";

export const CLIENT = new DiscordClient({
	intents: [
		// Required for guild / channel updates
		GatewayIntentBits.Guilds,
		// Required for voice updates
		GatewayIntentBits.GuildVoiceStates,
	],
	// Disable caching for unused features
	makeCache: Options.cacheWithLimits({
		...Options.DefaultMakeCacheSettings,
		ReactionManager: 0,
		ReactionUserManager: 0,
		GuildStickerManager: 0,
		GuildScheduledEventManager: 0,
	}),
});

export namespace Client {
	export async function start() {
		try {
			console.time("READY");

			ClientListeners.load();

			ClientUtils.verifyRequiredEnvironmentVariables();

			await ClientUtils.login();

			await checkForMigration();

			await ClientUtils.registerCommands();

			ScheduleUtils.loadSchedules();

			console.timeEnd("READY");

			// Post-bot-startup tasks

			ClientUtils.loadTopGGAutoPoster();

			ClientUtils.checkForOfflineVoiceChanges();

			ClientUtils.checkForPatchNotes();
		}
		catch (e) {
			const { message, stack } = e as Error;
			console.error("Failed to start bot:");
			console.error(`Error: ${message}`);
			console.error(`Stack Trace: ${stack}`);
		}
	}
}
