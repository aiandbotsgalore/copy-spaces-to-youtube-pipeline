path = '/opt/echomimic_v3/src/pipeline_wan_fun_inpaint_audio.py'
with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

target1 = """        if prompt is not None:
            batch_size = len(prompt)
        else:
            batch_size = prompt_embeds.shape[0]"""

repl1 = """        if prompt is not None:
            batch_size = len(prompt)
        elif isinstance(prompt_embeds, list):
            batch_size = len(prompt_embeds)
        else:
            batch_size = prompt_embeds.shape[0]"""

target2 = """        if prompt is not None and isinstance(prompt, str):
            batch_size = 1
        elif prompt is not None and isinstance(prompt, list):
            batch_size = len(prompt)
        else:
            batch_size = prompt_embeds.shape[0]"""

repl2 = """        if prompt is not None and isinstance(prompt, str):
            batch_size = 1
        elif prompt is not None and isinstance(prompt, list):
            batch_size = len(prompt)
        elif isinstance(prompt_embeds, list):
            batch_size = len(prompt_embeds)
        else:
            batch_size = prompt_embeds.shape[0]"""

if target1 in code:
    code = code.replace(target1, repl1)
    print("Patched target1")
else:
    print("target1 already patched or not found")

if target2 in code:
    code = code.replace(target2, repl2)
    print("Patched target2")
else:
    print("target2 already patched or not found")

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)
print("Pipeline patch applied successfully.")
