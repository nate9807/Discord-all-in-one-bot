import discord
from discord.ext import commands
import logging
from typing import Dict, Optional
import asyncio

# Configuration
class Config:
    GUILD_ID = 1234567890 #replace with ur guild id
    BOT_TOKEN = 'replace'
    TICKET_CATEGORY_NAME = 'Tickets'
    COMMAND_PREFIX = '!'
    EMBED_COLOR = 0x0099ff
    SUCCESS_COLOR = 0x00ff00
    ERROR_COLOR = 0xff0000

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Ticket data structure
class Ticket:
    def __init__(self, user_id: int, channel_id: int):
        self.user_id = user_id
        self.channel_id = channel_id
        self.created_at = discord.utils.utcnow()

# Bot setup
intents = discord.Intents.default()
intents.messages = True
intents.guilds = True
intents.dm_messages = True
intents.message_content = True

bot = commands.Bot(
    command_prefix=Config.COMMAND_PREFIX,
    intents=intents,
    help_command=None
)

# Ticket storage
class TicketManager:
    def __init__(self):
        self.tickets: Dict[int, Ticket] = {}

    def add_ticket(self, user_id: int, channel_id: int) -> None:
        self.tickets[user_id] = Ticket(user_id, channel_id)

    def get_ticket(self, user_id: int) -> Optional[Ticket]:
        return self.tickets.get(user_id)

    def remove_ticket(self, user_id: int) -> None:
        self.tickets.pop(user_id, None)

ticket_manager = TicketManager()

# Utility functions
async def create_error_embed(description: str) -> discord.Embed:
    return discord.Embed(
        description=description,
        color=Config.ERROR_COLOR,
        timestamp=discord.utils.utcnow()
    )

async def create_success_embed(description: str) -> discord.Embed:
    return discord.Embed(
        description=description,
        color=Config.SUCCESS_COLOR,
        timestamp=discord.utils.utcnow()
    )

# Events
@bot.event
async def on_ready():
    # Set custom status
    activity = discord.Activity(
        type=discord.ActivityType.watching,
        name="DM me for help!"
    )
    await bot.change_presence(activity=activity)
    
    logger.info(f'Logged in as {bot.user} (ID: {bot.user.id})')
    guild = bot.get_guild(Config.GUILD_ID)
    if not guild:
        logger.error('Guild not found')
        return

    ticket_category = discord.utils.get(guild.categories, name=Config.TICKET_CATEGORY_NAME)
    if not ticket_category:
        try:
            admin_roles = [role for role in guild.roles if role.permissions.administrator]
            overwrites = {
                guild.default_role: discord.PermissionOverwrite(view_channel=False),
                **{role: discord.PermissionOverwrite(
                    view_channel=True,
                    send_messages=True,
                    manage_messages=True,
                    manage_channels=True
                ) for role in admin_roles}
            }
            ticket_category = await guild.create_category(
                Config.TICKET_CATEGORY_NAME,
                overwrites=overwrites
            )
            logger.info('Created Tickets category with admin permissions')
        except Exception as e:
            logger.error(f'Failed to create ticket category: {e}')
            return

    try:
        await bot.tree.sync(guild=discord.Object(id=Config.GUILD_ID))
        logger.info('Slash commands synchronized successfully')
    except Exception as e:
        logger.error(f'Failed to sync commands: {e}')

@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    if message.guild:
        await bot.process_commands(message)
        return

    await handle_modmail(message)

async def handle_modmail(message: discord.Message):
    guild = bot.get_guild(Config.GUILD_ID)
    if not guild:
        logger.error('Guild not found')
        return

    ticket_category = discord.utils.get(guild.categories, name=Config.TICKET_CATEGORY_NAME)
    if not ticket_category:
        logger.error('Ticket category not found')
        return

    user = message.author
    existing_ticket = ticket_manager.get_ticket(user.id)

    try:
        if existing_ticket:
            ticket_channel = bot.get_channel(existing_ticket.channel_id)
            if ticket_channel:
                embed = discord.Embed(
                    title=f"Message from {user.name}",
                    description=message.content,
                    color=Config.EMBED_COLOR,
                    timestamp=discord.utils.utcnow()
                )
                embed.set_author(name=str(user), icon_url=user.avatar.url)
                await ticket_channel.send(embed=embed)
                await message.reply(embed=await create_success_embed('Message sent!'))
        else:
            admin_roles = [role for role in guild.roles if role.permissions.administrator]
            overwrites = {
                guild.default_role: discord.PermissionOverwrite(view_channel=False),
                **{role: discord.PermissionOverwrite(
                    view_channel=True,
                    send_messages=True,
                    manage_messages=True
                ) for role in admin_roles},
                user: discord.PermissionOverwrite(view_channel=True, send_messages=True)
            }
            
            ticket_channel = await guild.create_text_channel(
                f'ticket-{user.id}',
                category=ticket_category,
                overwrites=overwrites,
                topic=f'Modmail ticket for {user.name}#{user.discriminator}'
            )

            embed = discord.Embed(
                title='New Support Ticket',
                description=message.content,
                color=Config.EMBED_COLOR,
                timestamp=discord.utils.utcnow()
            )
            embed.set_author(name=str(user), icon_url=user.avatar.url)
            embed.add_field(name='User ID', value=str(user.id), inline=True)
            await ticket_channel.send(embed=embed)
            
            ticket_manager.add_ticket(user.id, ticket_channel.id)
            await message.reply(embed=await create_success_embed('Ticket created successfully!'))

    except Exception as e:
        logger.error(f'Error handling modmail: {e}')
        await message.reply(embed=await create_error_embed('An error occurred while processing your message.'))

# Commands
@bot.command(name='reply', aliases=['r'])
@commands.has_permissions(manage_messages=True)
async def reply_command(ctx: commands.Context, *, response: str):
    await handle_reply(ctx.channel, ctx.author, response)

@bot.tree.command(
    name='reply',
    description='Reply to a support ticket',
    guild=discord.Object(id=Config.GUILD_ID)
)
async def reply_slash(interaction: discord.Interaction, message: str):
    await handle_reply(interaction.channel, interaction.user, message, interaction)

async def handle_reply(
    channel: discord.TextChannel,
    author: discord.Member,
    response: str,
    interaction: Optional[discord.Interaction] = None
):
    if channel.category.name != Config.TICKET_CATEGORY_NAME:
        return

    if not channel.permissions_for(author).manage_messages:
        error_msg = 'You need Manage Messages permission to use this command.'
        if interaction:
            await interaction.response.send_message(embed=await create_error_embed(error_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_error_embed(error_msg))
        return

    ticket_info = next(
        (ticket for ticket in ticket_manager.tickets.values() if ticket.channel_id == channel.id),
        None
    )
    if not ticket_info:
        error_msg = 'This is not a valid ticket channel.'
        if interaction:
            await interaction.response.send_message(embed=await create_error_embed(error_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_error_embed(error_msg))
        return

    user = await bot.fetch_user(ticket_info.user_id)
    if not user:
        error_msg = 'Ticket owner not found.'
        if interaction:
            await interaction.response.send_message(embed=await create_error_embed(error_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_error_embed(error_msg))
        return

    embed = discord.Embed(
        title=f'Reply from {author.name}',
        description=response,
        color=Config.SUCCESS_COLOR,
        timestamp=discord.utils.utcnow()
    )
    embed.set_author(name=str(author), icon_url=author.avatar.url)

    try:
        await user.send(embed=embed)
        await channel.send(embed=embed)
        success_msg = f'Reply sent to {user.name}'
        if interaction:
            await interaction.response.send_message(embed=await create_success_embed(success_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_success_embed(success_msg))
    except discord.Forbidden:
        error_msg = 'Cannot send message to this user (DMs might be disabled).'
        if interaction:
            await interaction.response.send_message(embed=await create_error_embed(error_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_error_embed(error_msg))

@bot.command(name='close', aliases=['c'])
@commands.has_permissions(manage_messages=True)
async def close_command(ctx: commands.Context):
    await handle_close(ctx.channel, ctx.author)

@bot.tree.command(
    name='close',
    description='Close a support ticket',
    guild=discord.Object(id=Config.GUILD_ID)
)
async def close_slash(interaction: discord.Interaction):
    await handle_close(interaction.channel, interaction.user, interaction)

async def handle_close(
    channel: discord.TextChannel,
    author: discord.Member,
    interaction: Optional[discord.Interaction] = None
):
    if channel.category.name != Config.TICKET_CATEGORY_NAME:
        return

    if not channel.permissions_for(author).manage_messages:
        error_msg = 'You need Manage Messages permission to use this command.'
        if interaction:
            await interaction.response.send_message(embed=await create_error_embed(error_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_error_embed(error_msg))
        return

    ticket_info = next(
        (ticket for ticket in ticket_manager.tickets.values() if ticket.channel_id == channel.id),
        None
    )
    if not ticket_info:
        error_msg = 'This is not a valid ticket channel.'
        if interaction:
            await interaction.response.send_message(embed=await create_error_embed(error_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_error_embed(error_msg))
        return

    user = await bot.fetch_user(ticket_info.user_id)
    try:
        success_msg = 'Closing ticket...'
        if interaction:
            await interaction.response.send_message(embed=await create_success_embed(success_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_success_embed(success_msg))
        
        await asyncio.sleep(1)  # Give time for the message to be seen
        await channel.delete()
        
        if user:
            await user.send(embed=await create_success_embed(
                f'Thanks for contacting support, {user.name}! Your ticket has been closed.'
            ))
        ticket_manager.remove_ticket(ticket_info.user_id)
    except Exception as e:
        logger.error(f'Error closing ticket: {e}')
        error_msg = 'Failed to close ticket due to an error.'
        if interaction and not interaction.response.is_done():
            await interaction.response.send_message(embed=await create_error_embed(error_msg), ephemeral=True)
        else:
            await channel.send(embed=await create_error_embed(error_msg))

# Error handling
@bot.event
async def on_command_error(ctx: commands.Context, error: commands.CommandError):
    if isinstance(error, commands.MissingPermissions):
        await ctx.send(embed=await create_error_embed('You lack the required permissions to use this command.'))
    elif isinstance(error, commands.CommandNotFound):
        await ctx.send(embed=await create_error_embed('Command not found.'))
    else:
        logger.error(f'Unhandled command error: {error}')
        await ctx.send(embed=await create_error_embed('An unexpected error occurred.'))

# Run the bot
if __name__ == '__main__':
    try:
        bot.run(Config.BOT_TOKEN)
    except Exception as e:
        logger.error(f'Failed to start bot: {e}')