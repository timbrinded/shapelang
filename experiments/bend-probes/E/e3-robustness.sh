#!/usr/bin/env bash
# E3 robustness: (a) apply the scan's suggested shapes to a copy of the
# coverage-gaps model and re-scan (should be gap-free and still check);
# (b) paraphrase the doc sentences and vary the call syntax to measure how
# brittle the deterministic extraction is.
set -u
E=/home/user/shapelang/experiments/bend-probes/E
SHP="bun /home/user/shapelang/packages/shp-cli/src/index.ts"
W=${WORK:-/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/work/E}/e3
FX=fixtures/skills/index/coverage-gaps
summ() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(sorted(f['kind'] for f in d['findings']))"; }

# (a) close the loop
P=$W/patched; rm -rf $P; mkdir -p $P; cp -r $W/root/fixtures $P/
cat >> $P/$FX/shape/system.shape <<'EOF'

relation UploadCallsWorker {
  kind calls
  connects UploadApi -> ThumbnailWorker
}

relation UploadWaitsForResize {
  kind coordinated_call
  connects UploadApi -> ThumbnailWorker -> Thumbnail
  summary "Uploads complete only after the thumbnail worker has accepted the resize operation."
}

binding ImageDocs {
  when_changed paths {
    "fixtures/skills/index/coverage-gaps/shape/system.shape"
    "fixtures/skills/index/coverage-gaps/src/upload.ts"
    "fixtures/skills/index/coverage-gaps/src/worker.ts"
  }
  require_changed paths {
    "fixtures/skills/index/coverage-gaps/docs/images.md"
  }
}
EOF
echo "== (a) patched model: check"; (cd $P && $SHP check $FX/shape/system.shape; echo "exit=$?")
echo "== (a) patched model: scan findings"; bun $E/e3-index-scan.ts $P $FX | summ
printf "%s\n" $FX/src/upload.ts > $W/changed-upload.txt
echo "== (a) patched model: changed upload.ts without docs (binding should fire)"; (cd $P && $SHP check --changed-files $W/changed-upload.txt $FX/shape/system.shape 2>&1 | head -4; echo "exit=${PIPESTATUS[0]}")

# (b) paraphrases of the review sentence
review=(
  "Changes to the upload path, worker path, or authored image model require review of this document."
  "Any change to upload or worker code, or to the image model, must be reviewed against this page."
  "Keep this document in sync with the upload and worker sources and the image model."
  "When you touch upload, worker, or the Shape model, update this document."
  "Reviewers must re-read this page whenever the upload path, the worker path or the authored image model changes."
  "This page is normative for the upload and worker code paths and the image model; edits there need a docs review."
)
ordering=(
  "Uploads complete only after the thumbnail worker has accepted the resize operation."
  "An upload is not finished until the thumbnail worker accepts the resize."
  "The worker must accept the resize before an upload can complete."
  "Upload completion waits for the thumbnail worker to acknowledge the resize operation."
)
i=0; hitR=0
for s in "${review[@]}"; do
  i=$((i+1)); V=$W/para-r$i; rm -rf $V; mkdir -p $V; cp -r $W/root/fixtures $V/
  printf "# Image processing\n\nUploads complete only after the thumbnail worker has accepted the resize operation.\n%s\n" "$s" > $V/$FX/docs/images.md
  k=$(bun $E/e3-index-scan.ts $V $FX | summ); [[ $k == *missing-binding* ]] && hitR=$((hitR+1)) && r=hit || r=miss
  echo "review paraphrase $i: $r :: $s"
done
i=0; hitO=0
for s in "${ordering[@]}"; do
  i=$((i+1)); V=$W/para-o$i; rm -rf $V; mkdir -p $V; cp -r $W/root/fixtures $V/
  printf "# Image processing\n\n%s\n" "$s" > $V/$FX/docs/images.md
  k=$(bun $E/e3-index-scan.ts $V $FX | summ); [[ $k == *ordering-candidate* ]] && hitO=$((hitO+1)) && r=hit || r=miss
  echo "ordering paraphrase $i: $r :: $s"
done
echo "review paraphrases detected: $hitR/${#review[@]}; ordering paraphrases detected: $hitO/${#ordering[@]}"

# (b) call-syntax variants for the calls relation
variants=(
  'import { resizeImage } from "./worker";|export async function acceptImage(imageId: string): Promise<void> {\n  await resizeImage(imageId);\n}'
  'import { resizeImage as resize } from "./worker";|export async function acceptImage(imageId: string): Promise<void> {\n  await resize(imageId);\n}'
  'import * as worker from "./worker";|export async function acceptImage(imageId: string): Promise<void> {\n  await worker.resizeImage(imageId);\n}'
  'import { resizeImage } from "./worker";|export const acceptImage = async (imageId: string): Promise<void> => {\n  await resizeImage(imageId);\n};'
  '|export async function acceptImage(imageId: string): Promise<void> {\n  const { resizeImage } = await import("./worker");\n  await resizeImage(imageId);\n}'
  'import { resizeImage } from "./worker";|export async function acceptImage(imageId: string): Promise<void> {\n  const steps = [resizeImage];\n  for (const s of steps) await s(imageId);\n}'
)
i=0; hitC=0
for v in "${variants[@]}"; do
  i=$((i+1)); V=$W/call-v$i; rm -rf $V; mkdir -p $V; cp -r $W/root/fixtures $V/
  printf "%s\n\n%b\n" "${v%%|*}" "${v#*|}" > $V/$FX/src/upload.ts
  k=$(bun $E/e3-index-scan.ts $V $FX | summ); [[ $k == *missing-calls-relation* ]] && hitC=$((hitC+1)) && r=hit || r=miss
  echo "call variant $i: $r :: $(head -c 60 $V/$FX/src/upload.ts | tr '\n' ' ')"
done
echo "call variants detected: $hitC/${#variants[@]}"
