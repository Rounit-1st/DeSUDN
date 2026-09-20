import os 
cwd = os.getcwd() 

CHUNK_SIZE = 1024 * 1024

with open("new.tar.xz", "rb") as f:
    path = os.path.join(cwd, "chunk_store")
    os.makedirs(path,exist_ok=True)
    index = 0
    while data := f.read(CHUNK_SIZE):
        # store/send chunk
        # print(index, len(data))
        with open(f"chunk_store/{str(index)}", "wb") as f:
            f.write(data)
        index += 1