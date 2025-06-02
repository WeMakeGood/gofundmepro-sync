# Organization Setup Guide

This guide will help you add a new organization to the sync system using either the interactive wizard or command line interface.

## Quick Start (Recommended)

The easiest way to add an organization is using the interactive wizard:

```bash
npm run org:setup
```

This will guide you through each step with helpful prompts.

## Interactive Wizard Features

The interactive wizard will ask you for:

### Required Information
- **Organization Name** - Display name for your organization
- **Classy Organization ID** - Your numeric organization ID from Classy
- **Classy Client ID** - API client ID from your Classy account
- **Classy Client Secret** - API client secret from your Classy account

### Optional Information
- **MailChimp API Key** - For MailChimp integration (can be added later)
- **MailChimp Server Prefix** - Server prefix from your MailChimp account (e.g., "us15")
- **MailChimp Audience ID** - Target audience for syncing
- **Description** - Organization description
- **Website URL** - Organization website
- **Auto Sync Settings** - Enable/disable automatic syncing and set interval

## Finding Your Classy Credentials

1. Log into your Classy account
2. Go to **Settings** → **API**
3. Create a new API application if you don't have one
4. Copy the **Client ID** and **Client Secret**
5. Note your **Organization ID** (usually visible in the URL or account settings)

## Command Line Mode

For automation or if you prefer command line, you can also add organizations directly:

```bash
npm run org:add "Organization Name" 12345 "client_id" "client_secret"
```

## After Setup

Once your organization is created, you can:

- **View details**: `npm run org:show <organization_id>`
- **Start syncing**: `npm run org:sync <organization_id>`
- **List all organizations**: `npm run org:list`

## Security

- All API credentials are encrypted using AES-256-GCM encryption
- Credentials are only decrypted when needed for API calls
- Each organization's data is completely isolated from others

## Troubleshooting

If you encounter issues:

1. **Invalid Classy ID**: Make sure you're using the numeric organization ID, not the organization name
2. **API Authentication Failed**: Verify your Client ID and Secret are correct and the API application is active
3. **MailChimp Issues**: MailChimp integration is optional - you can skip it during setup and add it later

For more help, run `npm run org:add` without arguments to see all available commands.