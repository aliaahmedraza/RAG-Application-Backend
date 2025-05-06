// import { Worker } from 'bullmq';
// // import IORedis from 'ioredis';
// import dotenv from 'dotenv';
// import { QdrantVectorStore } from "@langchain/qdrant";
// // import { OpenAIEmbeddings } from "@langchain/openai";
// import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
// import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
// import { QdrantClient } from "@qdrant/js-client-rest";
// import { v4 as uuidv4 } from 'uuid';
// // import { FakeEmbeddings } from "@langchain/core/utils/testing";
// import { CohereEmbeddings } from "@langchain/community/embeddings/cohere";

// dotenv.config();
// // const connection = new IORedis(process.env.REDIS_URL, {
// //     maxRetriesPerRequest: null
// // });
// // console.log("Redis connection established", connection, process.env.REDIS_URL);
// const worker = new Worker(
//     'file-upload-queue',
//     async job => {
//         try {
//             console.log("Job data:", job.data);

//             const data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;
//             const loader = new PDFLoader(data.filePath);
//             const docs = await loader.load();

//             const splitter = new RecursiveCharacterTextSplitter({
//                 chunkSize: 500,
//                 chunkOverlap: 1,
//             });

//             const splitDocs = await splitter.splitDocuments(docs);
//             const splitDocsWithId = splitDocs.map(doc => ({
//                 ...doc,
//                 metadata: {
//                     ...doc.metadata,
//                     id: uuidv4(),
//                 }
//             }));

//             console.log("Sample processed documents:", splitDocsWithId.slice(0, 3));
//             const qdrantUrl = process.env.QDRANT_URL;
//             const client = new QdrantClient({ url: qdrantUrl });


//             // const embeddings = new OpenAIEmbeddings({
//             //     model: "text-embedding-3-small",
//             //     apiKey: process.env.OPENAI_API_KEY,
//             // });


//             // const embeddings = new FakeEmbeddings(); // Returns random vectors for testing
//             const embeddings = new CohereEmbeddings({
//                 apiKey: process.env.COHERE_API_KEY,
//                 model: "embed-english-v3.0",
//             });

//             // Step 4: Create or connect to Qdrant collection and store embeddings
//             const vectorStore = await QdrantVectorStore.fromDocuments(
//                 splitDocsWithId,
//                 embeddings,
//                 {
//                     url: qdrantUrl,
//                     collectionName: "pdf-docs",
//                 }
//             );

//             console.log("All documents added to Qdrant successfully");

//         } catch (error) {
//             console.error("Failed to process job:", error);
//         }
//     },
//     {
//         connection: {
//             host: process.env.REDIS_HOST,
//             port: process.env.REDIS_PORT,
//         }
//     }
// );
// worker.on('completed', (job) => {
//     console.log(`Job ${job.id} completed successfully`);
// });
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { v4 as uuidv4 } from 'uuid';
import { CohereEmbeddings } from "@langchain/community/embeddings/cohere";

dotenv.config();

// ─── Connect to Valkey (Redis-protocol) instead of Redis Cloud ─────────────────
const connection = new IORedis(process.env.VALKEY_URL, {
    maxRetriesPerRequest: null
});
console.log("✅ Redis connected:", process.env.VALKEY_URL);

// ─── Worker Definition ────────────────────────────────────────────────────────
const worker = new Worker(
    'file-upload-queue',
    async job => {
        try {
            console.log("▶️  Job data received:", job.data);

            // 1) Load PDF
            const data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;
            console.log("   • Loading PDF from:", data.filePath);
            const loader = new PDFLoader(data.filePath);
            const docs = await loader.load();
            console.log(`   • Loaded ${docs.length} pages/chunks from PDF.`);

            // 2) Split into smaller documents
            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 500,
                chunkOverlap: 1,
            });
            const splitDocs = await splitter.splitDocuments(docs);
            console.log(`   • Split into ${splitDocs.length} chunks.`);

            // 3) Assign unique IDs
            const splitDocsWithId = splitDocs.map(doc => ({
                ...doc,
                metadata: { ...doc.metadata, id: uuidv4() }
            }));
            console.log("   • Sample chunk:", splitDocsWithId[0]);

            // 4) Embed & upsert into Qdrant
            const qdrantUrl = process.env.QDRANT_URL;
            if (!qdrantUrl) throw new Error("Missing QDRANT_URL!");
            console.log("   • Inserting into Qdrant at", qdrantUrl);

            const embeddings = new CohereEmbeddings({
                apiKey: process.env.COHERE_API_KEY,
                model: "embed-english-v3.0",
            });

            await QdrantVectorStore.fromDocuments(
                splitDocsWithId,
                embeddings,
                { url: qdrantUrl, collectionName: "pdf-docs" }
            );

            console.log("✅ Successfully added all documents to Qdrant.");

            return { inserted: splitDocsWithId.length };
        }
        catch (error) {
            console.error("❌ Failed to process job:", error);
            throw error;
        }
    },
    { connection }
);

// ─── Job Lifecycle Logging ────────────────────────────────────────────────────
worker.on('active', job => {
    console.log(`🕑 Processing job ${job.id}…`);
});
worker.on('completed', (job, returnvalue) => {
    console.log(`🎉 Job ${job.id} completed successfully.`, returnvalue);
});
worker.on('failed', (job, err) => {
    console.error(`💥 Job ${job.id} failed with error:`, err);
});

