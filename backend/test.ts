import { performance } from "perf_hooks";
import supertest from "supertest";
import { ChargeResult, buildApp } from "./app";

const app = supertest(buildApp());

async function basicLatencyTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    console.log(`Latency: ${performance.now() - start} ms`);
}

const sleep = (delay: number) => new Promise((resolve => setTimeout(resolve, delay)));
async function basicChargeTest() {
    const promises: Promise<supertest.Response>[] = [];
    const results: ChargeResult[] = [];

    await app.post("/reset").expect(204);
    for (let i=0; i<22; i++) {
        const delay = 1000*Math.floor(i/2);
        const promise = sleep(delay).then(
            () => app
                .post("/charge")
                .expect(200)
                .then((response) => {
                    const result: ChargeResult = {
                        isAuthorized: response.body.isAuthorized,
                        remainingBalance: response.body.remainingBalance,
                        charges: response.body.charges,
                    };
                    results.push(result);
                    return response;
                })
            );
        promises.push(promise);
    }
    await Promise.allSettled(promises);
    console.log(`Results: ${JSON.stringify(results, undefined, 2)}`);    
}

async function runTests() {
    // await basicLatencyTest();
    await basicChargeTest();
}

runTests().catch(console.error);
