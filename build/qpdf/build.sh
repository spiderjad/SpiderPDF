#!/bin/bash
# Compila qpdf (Apache 2.0) a WebAssembly dentro de la imagen fijada de Emscripten. Reproducible:
#   npm run qpdf:build      (lanza: docker run … emscripten/emsdk@sha256:… bash build/qpdf/build.sh)
# Resultado: src/engine/qpdf/qpdf.mjs + qpdf.wasm, y SHA256SUMS (comprobado por las pruebas).
# Dependencias: zlib y libjpeg de los «ports» de Emscripten (licencias zlib e IJG, permisivas).
# Criptografía: la propia de qpdf (native), sin OpenSSL ni GnuTLS.
set -euo pipefail

QPDF_VERSION=12.4.2
QPDF_SHA256=8a58af5b6141319287c1883bec8bd1bd545b7567b7fc5e6ce5d25a1c85f36397
REPO=/repo
OUT=$REPO/src/engine/qpdf
WORK=/tmp/qpdf-build

export SOURCE_DATE_EPOCH=1700000000 # sin fechas de compilación en el binario
mkdir -p "$WORK" && cd "$WORK"
if [ ! -f qpdf-$QPDF_VERSION.tar.gz ]; then
  curl -fsSLO https://github.com/qpdf/qpdf/releases/download/v$QPDF_VERSION/qpdf-$QPDF_VERSION.tar.gz
fi
echo "$QPDF_SHA256  qpdf-$QPDF_VERSION.tar.gz" | sha256sum -c -
rm -rf qpdf-$QPDF_VERSION && tar xzf qpdf-$QPDF_VERSION.tar.gz

# zlib y libjpeg ya compilados para wasm (ports de Emscripten).
embuilder build zlib libjpeg
SYSROOT=$(em-config CACHE)/sysroot
LIBDIR=$SYSROOT/lib/wasm32-emscripten

cd qpdf-$QPDF_VERSION
emcmake cmake -S . -B out -G "Unix Makefiles" \
  -DCMAKE_C_FLAGS="-fexceptions" -DCMAKE_CXX_FLAGS="-fexceptions" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON -DBUILD_DOC=OFF \
  -DINSTALL_EXAMPLES=OFF -DINSTALL_PKGCONFIG=OFF -DINSTALL_CMAKE_PACKAGE=OFF \
  -DUSE_IMPLICIT_CRYPTO=OFF -DREQUIRE_CRYPTO_NATIVE=ON \
  -DSKIP_OS_SECURE_RANDOM=OFF \
  -DZLIB_H_PATH=$SYSROOT/include -DZLIB_LIB_PATH=$LIBDIR/libz.a \
  -DLIBJPEG_H_PATH=$SYSROOT/include -DLIBJPEG_LIB_PATH=$LIBDIR/libjpeg.a \
  -DCMAKE_EXE_LINKER_FLAGS="-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createQpdf -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sENVIRONMENT=web,worker,node \
    -sEXPORTED_RUNTIME_METHODS=callMain,FS -sFILESYSTEM=1 -sFORCE_FILESYSTEM=1 -sDISABLE_EXCEPTION_CATCHING=0 -fexceptions"
cmake --build out --target qpdf -j"$(nproc)"

mkdir -p "$OUT"
cp out/qpdf/qpdf.js "$OUT/qpdf.mjs"
cp out/qpdf/qpdf.wasm "$OUT/qpdf.wasm"
cp LICENSE.txt "$OUT/LICENSE-qpdf.txt"
cd "$OUT" && sha256sum qpdf.mjs qpdf.wasm > SHA256SUMS
cat SHA256SUMS
