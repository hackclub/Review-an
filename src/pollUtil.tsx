import { Poll } from "@prisma/client";

import { prisma, PollWithOptions } from "./prisma";
import message from "./message";
import { app } from "./index";
import { stripMentions } from "./util";

export async function refreshPoll(pollId: number) {
  const poll = await getPoll(pollId);
  if (!poll) return;

  await app.client.chat.update({
    token: process.env.SLACK_TOKEN,
    text: "This message can't be displayed in your client.",
    blocks: message(poll),
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
    if (!response.ok) return null;

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
    return file?.permalink_public || file?.url_private || null;
  } catch (err) {
    console.error("Failed to upload image to Slack:", err);
    return null;
  }
}

export async function postPoll(
  poll: Poll,
  extra?: { description?: string; imageUrls?: string[] }
): Promise<Poll> {
  const blocks = message(await getPoll(poll.id));

  // Add description and images at the start (after title)
  if (extra?.description || (extra?.imageUrls && extra.imageUrls.length > 0)) {
    const insertIndex = 1; // After the title block
    const extraBlocks = [];

    if (extra.description) {
      extraBlocks.push({
        type: "section",
        text: { type: "mrkdwn", text: stripMentions(extra.description) },
      });
    }

    if (extra.imageUrls) {
      for (const imageUrl of extra.imageUrls) {
        const slackImageUrl = await uploadImageToSlack(
          imageUrl,
          poll.channel,
          poll.title
        );
        if (slackImageUrl) {
          extraBlocks.push({
            type: "image",
            image_url: slackImageUrl,
            alt_text: poll.title,
          });
        }
      }
    }

    blocks.splice(insertIndex, 0, ...extraBlocks);
  }

  const resp = await app.client.chat.postMessage({
    blocks,
    text: "This message can't be displayed in your client.",
    channel: poll.channel,
    token: process.env.SLACK_TOKEN,
  });

  poll = await prisma.poll.update({
    where: { id: poll.id },
    data: { timestamp: resp.message?.ts },
  });

  return poll;
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
