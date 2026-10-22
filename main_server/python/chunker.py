import os
import hashlib

torren_text = '''
    {
    "software_name": {software_name},
    "version_name": {version_name},
    "software_id": {software_id},
    "version_id": {version_id},
    "size": {patch_size},
    "chunk_size": {chunk_size},
    "patch_hash": {patch_hash},
    "software_hash": {software_hash},
    "chunks": [
        {chunk_hash_list}
    ]
    }
'''

hasher = hashlib.sha256()


def chunk_file(file, chunk_size=1024 * 1024):
    cwd = os.getcwd()
    path = os.path.join(cwd, "chunk_store")

    os.makedirs(path, exist_ok=True)

    # really slow operation optimise in future 
    for f in os.listdir(path):
        os.remove(os.path.join(path, f))

    

    with open(file, "rb") as f:
        index = 0

        buffer = ""
        while data := f.read(chunk_size):
            with open(os.path.join(path, str(index)), "wb") as chunk:
                chunk.write(data)
                hasher.update(data)
                buffer+=f'"{hasher.hexdigest()}",'

            index += 1

    return buffer;