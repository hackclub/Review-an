import { Poll } from "@prisma/client";

import { prisma, PollWithOptions } from "./prisma";
import message from "./message";
import { app } from "./index";
import { stripMentions } from "./util";

function buildExtraBlocks(poll: PollWithOptions): any[] {
  const extraBlocks = [];

  if (poll.description) {
    extraBlocks.push({
      type: "section",
      text: { type: "mrkdwn", text: stripMentions(poll.description) },
    });
  }

  if (poll.imageUrls && poll.imageUrls.length > 0) {
    for (const imageUrl of poll.imageUrls) {
      extraBlocks.push({
        type: "image",
        image_url: imageUrl,
        alt_text: poll.title,
      });
    }
  }

  return extraBlocks;
}

function buildFullBlocks(poll: PollWithOptions): any[] {
  const blocks = message(poll);
  const extraBlocks = buildExtraBlocks(poll);

  if (extraBlocks.length > 0) {
    blocks.splice(1, 0, ...extraBlocks);
  }

  return blocks;
}

export async function refreshPoll(pollId: number) {
  const poll = await getPoll(pollId);
  if (!poll) return;

  await app.client.chat.update({
    token: process.env.SLACK_TOKEN,
    text: "This message can't be displayed in your client.",
    blocks: buildFullBlocks(poll),
    ts: poll.timestamp!,
    channel: poll.channel,
  });
}

async function uploadImageToSlack(
  imageUrl: string,
  channel: string,
  altText: string
): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") ? "jpg" : "png";

    const uploaded = await app.client.files.uploadV2({
      token: process.env.SLACK_TOKEN,
      channel_id: channel,
      file: buffer,
      filename: `poll-image-${Date.now()}.${ext}`,
      alt_text: altText,
    });

    const file = uploaded.file ?? (uploaded.files as any)?.[0]?.files?.[0];
    const url = file?.permalink_public || file?.url_private;
    console.log("Uploaded image to Slack:", url);
    return url || null;
  } catch (err) {
    console.error("Failed to upload image to Slack:", err);
    return null;
  }
}

export async function postPoll(poll: Poll): Promise<Poll> {
  const fullPoll = await getPoll(poll.id);

  // Upload images to Slack and store the Slack URLs
  const slackImageUrls: string[] = [];
  if (fullPoll.imageUrls && fullPoll.imageUrls.length > 0) {
    for (const imageUrl of fullPoll.imageUrls) {
      const slackUrl = await uploadImageToSlack(
        imageUrl,
        poll.channel,
        poll.title
      );
      if (slackUrl) {
        slackImageUrls.push(slackUrl);
      }
    }

    // Update poll with Slack-hosted URLs
    await prisma.poll.update({
      where: { id: poll.id },
      data: { imageUrls: slackImageUrls },
    });
  }

  // Re-fetch to get updated imageUrls
  const updatedPoll = await getPoll(poll.id);

  const resp = await app.client.chat.postMessage({
    blocks: buildFullBlocks(updatedPoll),
    text: "This message can't be displayed in your client.",
    channel: poll.channel,
    token: process.env.SLACK_TOKEN,
  });

  const finalPoll = await prisma.poll.update({
    where: { id: poll.id },
    data: { timestamp: resp.message?.ts },
  });

  return finalPoll;
}

export async function getPoll(id: number): Promise<PollWithOptions> {
  const poll = await prisma.poll.findUnique({
    where: { id },
    include: {
      options: {
        orderBy: { id: "asc" },
        include: { votes: { orderBy: { createdOn: "asc" } } },
      },
      _count: { select: { votes: true } },
    },
  });

  return poll!;
}

const POLL_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function closeExpiredPolls() {
  const cutoff = new Date(Date.now() - POLL_DURATION_MS);

  const expiredPolls = await prisma.poll.findMany({
    where: {
      open: true,
      createdOn: { lte: cutoff },
    },
  });

  for (const poll of expiredPolls) {
    await prisma.poll.update({
      where: { id: poll.id },
      data: { open: false },
    });
    await refreshPoll(poll.id);
    console.log(`Auto-closed poll ${poll.id}: ${poll.title}`);
  }

  return expiredPolls.length;
}

export function startPollAutoCloseScheduler() {
  const CHECK_INTERVAL_MS = 300 * 1000; // Check every 5 minutes
  setInterval(async () => {
    try {
      const closed = await closeExpiredPolls();
      if (closed > 0) {
        console.log(`Auto-closed ${closed} expired poll(s)`);
      }
    } catch (err) {
      console.error("Error in poll auto-close scheduler:", err);
    }
  }, CHECK_INTERVAL_MS);
  console.log("Poll auto-close scheduler started (48 hour limit)");
}
