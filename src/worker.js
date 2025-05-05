import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { QdrantVectorStore } from "@langchain/qdrant";
// import { OpenAIEmbeddings } from "@langchain/openai";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from 'uuid';
// import { FakeEmbeddings } from "@langchain/core/utils/testing";
import { CohereEmbeddings } from "@langchain/community/embeddings/cohere";

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
});
const worker = new Worker(
    'file-upload-queue',
    async job => {
        try {
            console.log("Job data:", job.data);

            const data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;
            const loader = new PDFLoader(data.filePath);
            const docs = await loader.load();

            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 500,
                chunkOverlap: 1,
            });

            const splitDocs = await splitter.splitDocuments(docs);
            const splitDocsWithId = splitDocs.map(doc => ({
                ...doc,
                metadata: {
                    ...doc.metadata,
                    id: uuidv4(),
                }
            }));

            console.log("Sample processed documents:", splitDocsWithId.slice(0, 3));
            const qdrantUrl = process.env.QDRANT_URL;
            const client = new QdrantClient({ url: qdrantUrl });


            // const embeddings = new OpenAIEmbeddings({
            //     model: "text-embedding-3-small",
            //     apiKey: process.env.OPENAI_API_KEY,
            // });


            // const embeddings = new FakeEmbeddings(); // Returns random vectors for testing
            const embeddings = new CohereEmbeddings({
                apiKey: process.env.COHERE_API_KEY,
                model: "embed-english-v3.0",
            });

            // Step 4: Create or connect to Qdrant collection and store embeddings
            const vectorStore = await QdrantVectorStore.fromDocuments(
                splitDocsWithId,
                embeddings,
                {
                    url: qdrantUrl,
                    collectionName: "pdf-docs",
                }
            );

            console.log("All documents added to Qdrant successfully");

        } catch (error) {
            console.error("Failed to process job:", error);
        }
    },
    { connection }
);
worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed successfully`);
});