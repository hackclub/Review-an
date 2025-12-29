import "dotenv/config";

import { App, BlockAction, BlockElementAction } from "@slack/bolt";
import express, { Request, Response } from "express";

import { prisma } from "./prisma";
import { postPoll, refreshPoll } from "./pollUtil";

const expressApp = express();
expressApp.use(express.json());

export const app = new App({
  token: process.env.SLACK_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: {
    events: "/slack/events",
  },
});

// Vote button handler
app.action(/vote:(.+):(.+)/, async ({ action, ack, body }) => {
  await ack();

  const action_id = (action as BlockElementAction).action_id;
  const matches = action_id.match(/vote:(.+):(.+)/);
  if (!matches) {
    return;
  }

  const [, pollId, optionId] = matches;

  const poll = await prisma.poll.findUnique({
    where: { id: parseInt(pollId) },
    include: { options: true },
  });

  if (!poll || !poll.open) {
    return;
  }

  if (poll.multipleVotes) {
    const userVote = await prisma.vote.findUnique({
      where: {
        user_optionId: { user: body.user.id, optionId: parseInt(optionId) },
      },
      include: { option: true },
    });

    if (userVote) {
      await prisma.vote.delete({ where: { id: userVote.id } });
      await refreshPoll(parseInt(pollId));
      return;
    }
  } else {
    const userVote = await prisma.vote.findFirst({
      where: { user: body.user.id, pollId: parseInt(pollId) },
      include: { option: true },
    });

    if (userVote) {
      await prisma.vote.delete({ where: { id: userVote.id } });
      if (userVote.option.id === parseInt(optionId)) {
        await refreshPoll(parseInt(pollId));
        return;
      }
    }
  }

  await prisma.vote.create({
    data: {
      user: body.user.id,
      optionId: parseInt(optionId),
      pollId: poll.id,
    },
  });

  await refreshPoll(parseInt(pollId));
});

// Add option button handler
app.action(/addOption:(.+)/, async ({ ack, action, client, ...args }) => {
  await ack();

  const { trigger_id } = args.body as BlockAction;
  const action_id = (action as BlockElementAction).action_id;
  const matches = action_id.match(/addOption:(.+)/);
  if (!matches) return;

  const [, pollId] = matches;
  const poll = await prisma.poll.findUnique({ where: { id: parseInt(pollId) } });

  if (!poll || !poll.open || !poll.othersCanAdd) return;

  await client.views.open({
    trigger_id,
    view: {
      type: "modal",
      callback_id: "addOption",
      private_metadata: JSON.stringify({ poll: pollId }),
      title: { type: "plain_text", text: "Add Option" },
      submit: { type: "plain_text", text: "Add" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `Add an option to *${poll.title}*` },
        },
        {
          type: "input",
          block_id: "option",
          element: { type: "plain_text_input", action_id: "option" },
          label: { type: "plain_text", text: "Option" },
        },
      ],
    },
  });
});

// Add option modal submission
app.view("addOption", async ({ view, body, ack }) => {
  const pollId = JSON.parse(view.private_metadata).poll;
  const optionName = view.state.values.option.option.value!;

  await ack();

  const poll = await prisma.poll.findUnique({ where: { id: parseInt(pollId) } });
  if (!poll || !poll.open || !poll.othersCanAdd) return;

  await prisma.pollOption.create({
    data: {
      name: optionName,
      pollId: poll.id,
      createdBy: body.user.id,
    },
  });

  await refreshPoll(poll.id);
});

// REST API: Create poll
expressApp.post("/create", async (req: Request, res: Response) => {
  try {
    const { title, options, channel, othersCanAdd, multipleVotes, anonymous } =
      req.body;

    if (!title || !options || !channel) {
      res.status(400).json({
        ok: false,
        error: "Missing required fields: title, options, channel",
      });
      return;
    }

    const poll = await prisma.poll.create({
      data: {
        title,
        options: {
          createMany: {
            data: options.map((i: string) => ({ name: i })),
          },
        },
        channel,
        othersCanAdd: othersCanAdd ?? false,
        multipleVotes: multipleVotes ?? false,
        anonymous: anonymous ?? false,
      },
      include: { options: { select: { id: true, name: true } } },
    });

    const posted = await postPoll(poll);

    res.json({
      ok: true,
      poll: {
        id: posted.id,
        title: posted.title,
        channel: posted.channel,
        timestamp: posted.timestamp,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// REST API: Toggle poll
expressApp.post("/toggle/:id", async (req: Request, res: Response) => {
  try {
    const pollId = parseInt(req.params.id);
    const poll = await prisma.poll.findUnique({ where: { id: pollId } });

    if (!poll) {
      res.status(404).json({ ok: false, error: "Poll not found" });
      return;
    }

    await prisma.poll.update({
      where: { id: poll.id },
      data: { open: !poll.open },
    });

    await refreshPoll(poll.id);
    res.json({ ok: true, open: !poll.open });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Health check
expressApp.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, status: "healthy" });
});

// REST API: Get poll
expressApp.get("/poll/:id", async (req: Request, res: Response) => {
  try {
    const poll = await prisma.poll.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { options: { include: { votes: true } } },
    });

    if (!poll) {
      res.status(404).json({ ok: false, error: "Poll not found" });
      return;
    }

    res.json({ ok: true, poll });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Mount Slack events on Express
expressApp.use("/slack/events", app.receiver?.router ?? express.Router());

const PORT = parseInt(process.env.PORT as string) || 3000;

async function main() {
  await app.start();
  expressApp.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main();
