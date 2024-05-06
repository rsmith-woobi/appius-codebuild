rm -rf ./out
rm -rf ./lambda
rm -rf ./repo
mkdir ./repo
cp -r ~/repos/sveltekit-demo/* ./repo
# cp -r ~/repos/remix-demo/* ./repo
cd ./repo
npm install
cd ..