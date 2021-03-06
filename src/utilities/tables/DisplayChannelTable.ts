import { Message, MessageOptions, TextChannel, VoiceChannel } from "discord.js";
import { DisplayChannel } from "../Interfaces";
import { Base } from "../Base";

export class DisplayChannelTable extends Base {
   /**
    * Create & update DisplayChannel database table if necessary
    */
   public static initTable(): void {
      this.knex.schema.hasTable("display_channels").then(async (exists) => {
         if (!exists) {
            await this.knex.schema
               .createTable("display_channels", (table) => {
                  table.increments("id").primary();
                  table.text("queue_channel_id");
                  table.text("display_channel_id");
                  table.text("embed_id");
               })
               .catch((e) => console.error(e));
         }
      });

      this.updateTableStructure();
   }

   /**
    *
    * @param queueChannel
    * @param displayChannel
    * @param msgEmbed
    */
   public static async storeDisplayChannel(
      queueChannel: VoiceChannel | TextChannel,
      displayChannel: TextChannel,
      msgEmbed: MessageOptions
   ): Promise<void> {
      let embedId: string;
      // For each embed, send and collect the id
      await displayChannel
         .send(msgEmbed)
         .then((msg) => (embedId = (msg as Message)?.id))
         .catch(() => null);
      // Store the id in the database
      if (embedId) {
         await this.knex<DisplayChannel>("display_channels").insert({
            display_channel_id: displayChannel.id,
            embed_id: embedId,
            queue_channel_id: queueChannel.id,
         });
      }
   }

   /**
    *
    * @param queueChannelId
    * @param displayChannelIdToRemove
    * @param deleteOldDisplayMsg
    */
   public static async unstoreDisplayChannel(
      queueChannelId: string,
      displayChannelIdToRemove?: string,
      deleteOldDisplayMsg = true
   ): Promise<void> {
      let storedDisplayChannels: DisplayChannel[];

      // Retreive list of stored embeds for display channel
      if (displayChannelIdToRemove) {
         storedDisplayChannels = await this.knex<DisplayChannel>("display_channels")
            .where("queue_channel_id", queueChannelId)
            .where("display_channel_id", displayChannelIdToRemove);
         await this.knex<DisplayChannel>("display_channels")
            .where("queue_channel_id", queueChannelId)
            .where("display_channel_id", displayChannelIdToRemove)
            .del();
      } else {
         storedDisplayChannels = await this.knex<DisplayChannel>("display_channels").where("queue_channel_id", queueChannelId);
         await this.knex<DisplayChannel>("display_channels").where("queue_channel_id", queueChannelId).del();
      }

      if (!storedDisplayChannels || !deleteOldDisplayMsg) {
         return;
      }

      // If found, delete them from discord
      for (const storedDisplayChannel of storedDisplayChannels) {
         try {
            const displayChannel = (await this.client.channels.fetch(storedDisplayChannel.display_channel_id)) as TextChannel;
            const embed = await displayChannel.messages.fetch(storedDisplayChannel.embed_id, false);
            await embed.delete();
         } catch (e) {
            // EMPTY
         }
      }
   }

   /**
    * Modify the database structure for code patches
    */
   protected static updateTableStructure(): void {
      this.addEmbedId();
   }
   /**
    * Migration of embed_ids column to emdbed_id
    */
   private static async addEmbedId(): Promise<void> {
      if (await this.knex.schema.hasColumn("display_channels", "embed_ids")) {
         console.log("Migrating display embed ids");
         await this.knex.schema.table("display_channels", (table) => table.text("embed_id"));
         (await this.knex<DisplayChannel>("display_channels")).forEach(async (displayChannel) => {
            await this.knex<DisplayChannel>("display_channels")
               .where("display_channel_id", displayChannel.display_channel_id)
               .where("queue_channel_id", displayChannel.queue_channel_id)
               .update("embed_id", displayChannel["embed_ids"][0]);
         });
         await this.knex.schema.table("display_channels", (table) => table.dropColumn("embed_ids"));
      }
   }
}
