import fs from "node:fs";
import path from "node:path";
import FormData from "form-data";
import fetch from "node-fetch";

const directory: string = "chunk_store";
const uploadUrl: string = "http://server-b:3000/upload";

function addDirectory(
    form: FormData,
    dir: string,
    base: string = dir
): void {
    const entries: fs.Dirent[] = fs.readdirSync(dir, {
        withFileTypes: true
    });

    for (const entry of entries) {
        const fullPath: string = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            addDirectory(form, fullPath, base);
        } else if (entry.isFile()) {
            const relativePath: string = path.relative(base, fullPath);

            form.append(
                "files",
                fs.createReadStream(fullPath),
                {
                    filename: relativePath
                }
            );
        }
    }
}

async function uploadDirectory(): Promise<void> {
    if (!fs.existsSync(directory)) {
        throw new Error(`Directory does not exist: ${directory}`);
    }

    const form: FormData = new FormData();

    form.append("softwareNo", "software-001");
    form.append("version", "2.4.1");

    addDirectory(form, directory);

    const response = await fetch(uploadUrl, {
        method: "POST",
        body: form,
        headers: form.getHeaders()
    });

    if (!response.ok) {
        throw new Error(
            `Upload failed: ${response.status} ${response.statusText}`
        );
    }

    const result: string = await response.text();

    console.log(result);
}

uploadDirectory().catch((error: unknown) => {
    if (error instanceof Error) {
        console.error("Upload error:", error.message);
    } else {
        console.error("Upload error:", error);
    }

    process.exitCode = 1;
});