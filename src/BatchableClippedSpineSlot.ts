/** ****************************************************************************
 * Spine Runtimes License Agreement
 * Last updated July 28, 2023. Replaces all prior versions.
 *
 * Copyright (c) 2013-2023, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software or
 * otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THE
 * SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

import { Spine } from './Spine';

import type { Batch, BatchableObject, Batcher, IndexBufferArray, Texture } from 'pixi.js';
import type { SkeletonClipping, Slot } from '@esotericsoftware/spine-core';

export class BatchableClippedSpineSlot implements BatchableObject
{
    indexStart: number;
    textureId: number;
    texture: Texture;
    location: number;
    batcher: Batcher;
    batch: Batch;
    renderable: Spine;

    slot:Slot;
    indexSize: number;
    vertexSize: number;
    clippedVertices: number[] = [];
    clippedTriangles: number[] = [];

    roundPixels: 0 | 1;

    get blendMode() { return this.renderable.groupBlendMode; }

    reset()
    {
        this.renderable = null as any;
        this.texture = null as any;
        this.batcher = null as any;
        this.batch = null as any;
    }

    setClipper(clipper:SkeletonClipping)
    {
        // copy clipped verts and triangles
        copyArray(clipper.clippedVertices, this.clippedVertices);
        copyArray(clipper.clippedTriangles, this.clippedTriangles);

        this.vertexSize = (clipper.clippedVertices.length / 8);
        this.indexSize = clipper.clippedTriangles.length;
    }

    packIndex(indexBuffer: IndexBufferArray, index: number, indicesOffset: number)
    {
        const indices = this.clippedTriangles;

        for (let i = 0; i < indices.length; i++)
        {
            indexBuffer[index++] = indices[i] + indicesOffset;
        }
    }

    packAttributes(
        float32View: Float32Array,
        uint32View: Uint32Array,
        index: number,
        textureId: number
    )
    {
        const clippedVertices = this.clippedVertices;
        const vertexSize = this.vertexSize;

        const abgr = this.renderable.groupColor;

        const textureIdAndRound = (textureId << 16) | (this.roundPixels & 0xFFFF);

        for (let i = 0; i < vertexSize; i++)
        {
            const localIndex = i * 8;

            // position
            float32View[index++] = clippedVertices[localIndex];
            float32View[index++] = clippedVertices[localIndex + 1];

            // uv
            float32View[index++] = clippedVertices[localIndex + 6];
            float32View[index++] = clippedVertices[localIndex + 7];
            // color
            uint32View[index++] = abgr;

            // texture id
            float32View[index++] = textureIdAndRound;
        }
    }
}

function copyArray(a:number[], b:number[])
{
    for (let i = 0; i < a.length; i++)
    {
        b[i] = a[i];
    }
}
