import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { v4 as uuidv4 } from 'uuid';
import { CohereEmbeddings } from "@langchain/community/embeddings/cohere";
import fs from 'fs/promises';

dotenv.config();

if (!process.env.COHERE_API_KEY) {
    console.error("CRITICAL: COHERE_API_KEY is not defined. Worker cannot start.");
    process.exit(1);
}

const connection = new IORedis(process.env.VALKEY_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    reconnectOnError: (err) => {
        console.warn("Redis reconnecting due to error:", err.message);
        return true;
    },
    enableOfflineQueue: true,
});
console.log("✅ Redis connected:", process.env.VALKEY_URL);


const worker = new Worker(
    process.env.QUEUE_NAME || 'file-upload-queue',
    async job => {
        try {
            console.log("▶️  Job data received:", job.data);


            const data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;
            console.log("   • Loading PDF from:", data.filePath);
            const loader = new PDFLoader(data.filePath);
            const docs = await loader.load();
            console.log(`   • Loaded ${docs.length} pages/chunks from PDF.`);


            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: parseInt(process.env.TEXT_SPLITTER_CHUNK_SIZE) || 500,
                chunkOverlap: parseInt(process.env.TEXT_SPLITTER_CHUNK_OVERLAP) || 1,
            });
            const splitDocs = await splitter.splitDocuments(docs);
            console.log(`   • Split into ${splitDocs.length} chunks.`);


            const splitDocsWithId = splitDocs.map(doc => ({
                ...doc,
                metadata: { ...doc.metadata, id: uuidv4() }
            }));
            console.log("   • Sample chunk:", splitDocsWithId[0]);


            const qdrantUrl = process.env.QDRANT_URL;
            if (!qdrantUrl) throw new Error("Missing QDRANT_URL!");
            console.log("   • Inserting into Qdrant at", qdrantUrl);

            // OpenAIEmbeddings and FakeEmbeddings were part of the removed old logic.
            // The active code uses CohereEmbeddings.
            const embeddings = new CohereEmbeddings({
                apiKey: process.env.COHERE_API_KEY, // Already an env var
                model: process.env.COHERE_EMBED_MODEL || "embed-english-v3.0",
            });

            await QdrantVectorStore.fromDocuments(
                splitDocsWithId,
                embeddings,
                { url: qdrantUrl, collectionName: process.env.QDRANT_COLLECTION_NAME || "pdf-docs" }
            );

            console.log("✅ Successfully added all documents to Qdrant.");

            try {
                console.log(`   • Deleting temporary file: ${data.filePath}`);
                await fs.unlink(data.filePath);
                console.log(`   • Successfully deleted temporary file: ${data.filePath}`);
            } catch (unlinkError) {
                console.error(` Failed to delete temporary file ${data.filePath}:`, unlinkError);
                // Decide if this error should cause the job to fail or just log a warning
                // For now, let's log it and not re-throw, as the main task (Qdrant insertion) was successful.
            }

            return { inserted: splitDocsWithId.length };
        }
        catch (error) {
            console.error(" Failed to process job:", error);
            // If the file path exists in data, try to clean it up even if the main processing failed.
            // This is a basic cleanup attempt; more robust error handling might be needed.
            const data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;
            if (data && data.filePath) {
                try {
                    console.log(`   • Attempting cleanup of temporary file due to error: ${data.filePath}`);
                    await fs.unlink(data.filePath);
                    console.log(`   • Successfully deleted temporary file during error cleanup: ${data.filePath}`);
                } catch (cleanupError) {
                    console.error(` Failed to delete temporary file ${data.filePath} during error cleanup:`, cleanupError);
                }
            }
            throw error;
        }
    },
    { connection }
);


worker.on('active', job => {
    console.log(` Processing job ${job.id}…`);
});
worker.on('completed', (job, returnvalue) => {
    console.log(` Job ${job.id} completed successfully.`, returnvalue);
});
worker.on('failed', (job, err) => {
    console.error(` Job ${job.id} failed with error:`, err);
});

