import csv from "csv-parser";
import fs from "fs";
import { get, isEmpty } from "lodash-es";
import moment from "moment-timezone";

import { CLIENT } from "../../client/client.ts";
import {
	Color,
	DisplayUpdateType,
	MemberDisplayType,
	ScheduleCommand,
	Scope,
	TimestampType,
} from "../../types/db.types.ts";
import { ClientUtils } from "../../utils/client.utils.ts";
import { db, DB_FILEPATH } from "../db.ts";
import { QUEUE_TABLE } from "../schema.ts";
import { Store } from "../store.ts";
import type {
	AdminPermission,
	BlackWhiteList,
	DisplayChannels,
	LastPulled,
	Priority,
	QueueChannels,
	QueueGuilds,
	QueueMembers,
	Schedules,
} from "./migrate.types.ts";

export const LEGACY_EXPORT_DIR = "data/migrations/legacy-export";

const legacyAdminPermission: AdminPermission[] = [];
const legacyBlackWhiteList: BlackWhiteList[] = [];
const legacyDisplayChannels: DisplayChannels[] = [];
const legacyLastPulled: LastPulled[] = [];
const legacyPriority: Priority[] = [];
const legacyQueueChannels: QueueChannels[] = [];
const legacyQueueGuilds: QueueGuilds[] = [];
const legacyQueueMembers: QueueMembers[] = [];
const legacySchedules: Schedules[] = [];

export async function checkForMigration() {
	const skipMigrationFlag = process.env.CHECK_FOR_LEGACY_MIGRATION;
	if (skipMigrationFlag.toLowerCase() === "true") {
		console.log(`Checking for legacy migration... (${LEGACY_EXPORT_DIR})`);
		if (fs.readdirSync(LEGACY_EXPORT_DIR).length) {
			console.log();
			console.log("Legacy migration detected.");
			console.log();
			console.warn(
				"If you proceed with migration:\n" +
				"!  1. Your database (data/main.sqlite) will be backed up to (data/main-pre-migration-${date}.sqlite)\n" +
				"!  2. Then the data from legacy-export will be merged into your database.\n" +
				"!  Do you wish to proceed with migration? [Y/n]"
			);

			const userInput = (await new Promise(resolve => process.stdin.once("data", resolve)))?.toString().trim();
			if (isEmpty(userInput) || userInput === "y") {
				console.log("Proceeding with legacy migration...");
				console.log();

				// Backup current database
				const backupPath = `data/main-pre-migration-${new Date().toISOString().replace(/:/g, "-")}.sqlite`;
				fs.copyFileSync(DB_FILEPATH, backupPath);

				await migrate();
			}
		}
	}
}

export async function migrate() {
	await loadExportData();
	await convertAndInsert();
}

export async function loadExportData() {
	const files = fs.readdirSync(LEGACY_EXPORT_DIR);
	await Promise.all(files.map(file => new Promise<void>((resolve, reject) => {
		const data: any[] = [];
		fs.createReadStream(`${LEGACY_EXPORT_DIR}/${file}`)
			.pipe(csv())
			.on("data", (row) => {
				data.push(row);
			})
			.on("end", () => {
				switch (file) {
					case "admin_permission.csv":
						legacyAdminPermission.push(...data);
						break;
					case "black_white_list.csv":
						legacyBlackWhiteList.push(...data);
						break;
					case "display_channels.csv":
						legacyDisplayChannels.push(...data);
						break;
					case "last_pulled.csv":
						legacyLastPulled.push(...data);
						break;
					case "priority.csv":
						legacyPriority.push(...data);
						break;
					case "queue_channels.csv":
						legacyQueueChannels.push(...data);
						break;
					case "queue_guilds.csv":
						legacyQueueGuilds.push(...data);
						break;
					case "queue_members.csv":
						legacyQueueMembers.push(...data);
						break;
					case "schedules.csv":
						legacySchedules.push(...data);
						break;
				}
				resolve();
			})
			.on("error", reject);
	}))
	);

	console.log("All streams have completed.");
	console.log("adminPermission length", legacyAdminPermission.length);
	console.log("blackWhiteList length", legacyBlackWhiteList.length);
	console.log("displayChannels length", legacyDisplayChannels.length);
	console.log("lastPulled length", legacyLastPulled.length);
	console.log("priority length", legacyPriority.length);
	console.log("queueChannels length", legacyQueueChannels.length);
	console.log("queueGuilds length", legacyQueueGuilds.length);
	console.log("queueMembers length", legacyQueueMembers.length);
	console.log("schedules length", legacySchedules.length);
	console.log();
}

function getTimeZonesForOffset(offset: number) {
	return moment.tz
		.names()
		.find((zoneName: string) => {
			const tzOffset = moment.tz(zoneName).utcOffset();
			return tzOffset === offset * 60;
		});
}

async function convertAndInsert() {
	console.log("Converting and inserting data:");
	// Force fetch of all guilds
	await CLIENT.guilds.fetch();

	await db.transaction(async () => {
		for (let i = 0; i < legacyQueueGuilds.length; i++) {
			const legacyGuild = legacyQueueGuilds[i];
			if (i % 25 === 24 || i === legacyQueueGuilds.length - 1) {
				console.log(`Converting guild ${i + 1} of ${legacyQueueGuilds.length}`);
			}

			const jsGuild = await ClientUtils.getGuild(legacyGuild.guild_id);
			if (!jsGuild) continue;
			const store = new Store(jsGuild);

			store.insertGuild({
				guildId: legacyGuild.guild_id,
				logChannelId: legacyGuild.logging_channel_id,
				logScope: legacyGuild.logging_channel_level ? Scope.All : undefined,
			});

			for (const legacyQueue of legacyQueueChannels.filter(legacy => legacy.guild_id == legacyGuild.guild_id)) {
				const jsSourceChannel = await jsGuild.channels.fetch(legacyQueue.queue_channel_id);
				if (!jsSourceChannel) continue;

				let queue;
				for (let i = 0; i < 5; i++) {
					const name = i === 0 ? jsSourceChannel.name : `${jsSourceChannel.name} (${i})`;
					try {
						queue = store.insertQueue({
							name: name,
							guildId: legacyGuild.guild_id,
							autopullToggle: legacyQueue.auto_fill,
							color: get(Color, legacyQueue.color) ?? QUEUE_TABLE.color.default,
							displayButtons: legacyQueue.hide_button ? Scope.None : Scope.All,
							displayUpdateType: (legacyGuild.msg_mode === 1) ? DisplayUpdateType.Edit : (legacyGuild.msg_mode === 2) ? DisplayUpdateType.Replace : DisplayUpdateType.New,
							header: legacyQueue.header,
							lockToggle: legacyQueue.is_locked,
							memberDisplayType: legacyGuild.disable_mentions ? MemberDisplayType.Plaintext : MemberDisplayType.Mention,
							notificationsToggle: !legacyGuild.disable_notifications,
							pullBatchSize: BigInt(legacyQueue.pull_num),
							rejoinGracePeriod: BigInt(legacyQueue.grace_period),
							roleInQueueId: legacyQueue.role_id,
							size: BigInt(legacyQueue.max_members),
							timestampType:
								legacyGuild.timestamps === "date" ? TimestampType.Date :
									legacyGuild.timestamps === "time" ? TimestampType.Time :
										legacyGuild.timestamps === "date+time" ? TimestampType.DateAndTime :
											legacyGuild.timestamps === "relative" ? TimestampType.Relative
												: TimestampType.Off,
							voiceDestinationChannelId: legacyQueue.target_channel_id,
						});
						break;
					}
					catch {
						// continue
					}
				}

				if ("isVoiceBased" in jsSourceChannel && jsSourceChannel.isVoiceBased()) {
					store.insertVoice({
						guildId: legacyGuild.guild_id,
						queueId: queue.id,
						sourceChannelId: legacyQueue.queue_channel_id,
					});
				}

				for (const legacyDisplay of legacyDisplayChannels.filter(legacy => legacy.queue_channel_id == legacyQueue.queue_channel_id)) {
					store.insertDisplay({
						guildId: legacyGuild.guild_id,
						queueId: queue.id,
						displayChannelId: legacyDisplay.display_channel_id,
						lastMessageId: legacyDisplay.message_id,
					});
				}

				for (const legacyMember of legacyQueueMembers.filter(legacy => legacy.channel_id == legacyQueue.queue_channel_id)) {
					store.insertMember({
						guildId: legacyGuild.guild_id,
						queueId: queue.id,
						userId: legacyMember.member_id,
						message: legacyMember.personal_message,
						joinTime: BigInt(new Date(legacyMember.display_time).getTime()),
						positionTime: BigInt(new Date(legacyMember.created_at).getTime()),
						priorityOrder: legacyMember.is_priority ? 5n : undefined,
					});
				}

				for (const legacySchedule of legacySchedules.filter(legacy => legacy.queue_channel_id == legacyQueue.queue_channel_id)) {
					store.insertSchedule({
						guildId: legacyGuild.guild_id,
						queueId: queue.id,
						command: legacySchedule.command as ScheduleCommand,
						cron: legacySchedule.schedule,
						timezone: getTimeZonesForOffset(legacySchedule.utc_offset),
						messageChannelId: legacyQueue.queue_channel_id,
					});
				}

				for (const legacyBlack of legacyBlackWhiteList.filter(legacy => legacy.queue_channel_id == legacyQueue.queue_channel_id && legacy.type === 0)) {
					store.insertBlacklisted({
						guildId: legacyGuild.guild_id,
						queueId: queue.id,
						subjectId: legacyBlack.role_member_id,
						isRole: legacyBlack.is_role,
					});
				}

				for (const legacyWhite of legacyBlackWhiteList.filter(legacy => legacy.queue_channel_id == legacyQueue.queue_channel_id && legacy.type === 1)) {
					store.insertWhitelisted({
						guildId: legacyGuild.guild_id,
						queueId: queue.id,
						subjectId: legacyWhite.role_member_id,
						isRole: legacyWhite.is_role,
					});
				}

				for (const legacyPrio of legacyPriority.filter(legacy => legacy.guild_id == legacyGuild.guild_id)) {
					store.insertPrioritized({
						guildId: legacyGuild.guild_id,
						queueId: queue.id,
						subjectId: legacyPrio.role_member_id,
						isRole: legacyPrio.is_role,
						priorityOrder: 5n,
					});
				}

				for (const legacyAdmin of legacyAdminPermission.filter(legacy => legacy.guild_id == legacyGuild.guild_id)) {
					store.insertAdmin({
						guildId: legacyGuild.guild_id,
						subjectId: legacyAdmin.role_member_id,
						isRole: legacyAdmin.is_role,
					});
				}
			}
		}
	});
	console.log();
	console.log("Conversion and insertion complete.");
	console.log();
}