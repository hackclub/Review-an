import { Poll } from "@prisma/client";

import { prisma, PollWithOptions } from "./prisma";
import message from "./message";
import { app } from "./index";

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

export async function postPoll(
  poll: Poll,
  extra?: { description?: string; imageUrl?: string }
): Promise<Poll> {
  const blocks = message(await getPoll(poll.id));

  // Add description and image at the start (after title)
  if (extra?.description || extra?.imageUrl) {
    const insertIndex = 1; // After the title block
    const extraBlocks = [];

    if (extra.description) {
      extraBlocks.push({
        type: "section",
        text: { type: "mrkdwn", text: extra.description },
      });
    }

    if (extra.imageUrl) {
      extraBlocks.push({
        type: "image",
        image_url: extra.imageUrl,
        alt_text: poll.title,
      });
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
