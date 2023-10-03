import express from "express";
import { WatchError, createClient } from "redis";
import { json } from "body-parser";

const DEFAULT_BALANCE = 100;

export interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

async function connect(): Promise<ReturnType<typeof createClient>> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    console.log(`Using redis URL ${url}`);
    const client = createClient({ url });
    await client.connect();
    return client;
}

async function reset(account: string): Promise<void> {
    const client = await connect();
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE);
    } finally {
        await client.disconnect();
    }
}

async function charge(account: string, charges: number, retries = 2): Promise<ChargeResult> {
    const client = await connect();
    try {
        // detect the race condition (i.e. throw an exception in `client.exec()`
        // if the balance is changed by another connection)
        await client.watch(`${account}/balance`);
        const balance = parseInt((await client.get(`${account}/balance`)) ?? "");
        // inverted the logic to improve the code readability
        if (balance < charges) {
            return { isAuthorized: false, remainingBalance: balance, charges: 0 };
        }
        const remainingBalance = await client
            // enable the transaction
            .multi()
            // atomic decrement
            .decrBy(`${account}/balance`, charges)
            // execute the transaction
            .exec()
            // get the result of the first (and only) command and cast it to number
            .then((response) => Number(response[0]));
        return { isAuthorized: true, remainingBalance, charges };
    } catch (error) {
        // we handle only WatchError, all other errors are rethrown
        if (!(error instanceof WatchError)) {
            throw error;
        }
        if (retries == 0) {
            throw new Error(`Too many retries while charging ${account}`);
        }
        console.log(`Retrying charge ${account} with ${retries} retries left`);
        return charge(account, charges, retries - 1);
    } finally {
        await client.disconnect();
    }
}

export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await charge(account, req.body.charges ?? 10);
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    return app;
}
