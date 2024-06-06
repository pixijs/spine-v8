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

import { AttachmentCacheData, Spine } from './Spine';

import type { Batch, BatchableObject, Batcher, BLEND_MODES, IndexBufferArray, Texture } from 'pixi.js';

export class BatchableSpineSlot implements BatchableObject
{
    indexStart: number;
    textureId: number;
    texture: Texture;
    location: number;
    batcher: Batcher;
    batch: Batch;
    renderable: Spine;

    vertices: Float32Array;
    indices: number[] | Uint16Array;
    uvs: Float32Array;

    indexSize: number;
    vertexSize: number;

    roundPixels: 0 | 1;
    data: AttachmentCacheData;
    blendMode: BLEND_MODES;

    setData(
        renderable:Spine,
        data:AttachmentCacheData,
        texture:Texture,
        blendMode:BLEND_MODES,
        roundPixels: 0 | 1)
    {
        this.renderable = renderable;
        this.data = data;

        if (data.clipped)
        {
            const clippedData = data.clippedData;

            this.indexSize = clippedData.indicesCount;
            this.vertexSize = clippedData.vertexCount;
            this.vertices = clippedData.vertices;
            this.indices = clippedData.indices;
            this.uvs = clippedData.uvs;
        }
        else
        {
            this.indexSize = data.indices.length;
            this.vertexSize = data.vertices.length / 2;
            this.vertices = data.vertices;
            this.indices = data.indices;
            this.uvs = data.uvs;
        }

        this.texture = texture;
        this.roundPixels = roundPixels;

        this.blendMode = blendMode;
    }

    packIndex(indexBuffer: IndexBufferArray, index: number, indicesOffset: number)
    {
        const indices = this.indices;

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
        const { uvs, vertices, vertexSize } = this;

        const slotColor = this.data.color;

        const parentColor:number = this.renderable.groupColor;
        const parentAlpha:number = this.renderable.groupAlpha;

        let abgr:number;

        const mixedA = (slotColor.a * parentAlpha) * 255;

        if (parentColor !== 0xFFFFFF)
        {
            const parentB = (parentColor >> 16) & 0xFF;
            const parentG = (parentColor >> 8) & 0xFF;
            const parentR = parentColor & 0xFF;

            const mixedR = (slotColor.r * parentR) * 255;
            const mixedG = (slotColor.g * parentG) * 255;
            const mixedB = (slotColor.b * parentB) * 255;

            abgr = ((mixedA) << 24) | (mixedB << 16) | (mixedG << 8) | mixedR;
        }
        else
        {
            abgr = ((mixedA) << 24) | ((slotColor.b * 255) << 16) | ((slotColor.g * 255) << 8) | (slotColor.r * 255);
        }

        const matrix = this.renderable.groupTransform;

        const a = matrix.a;
        const b = matrix.b;
        const c = matrix.c;
        const d = matrix.d;
        const tx = matrix.tx;
        const ty = matrix.ty;

        const textureIdAndRound = (textureId << 16) | (this.roundPixels & 0xFFFF);

        for (let i = 0; i < vertexSize; i++)
        {
            const x = vertices[i * 2];
            const y = vertices[(i * 2) + 1];

            float32View[index++] = (a * x) + (c * y) + tx;
            float32View[index++] = (b * x) + (d * y) + ty;

            // uv
            float32View[index++] = uvs[i * 2];
            float32View[index++] = uvs[(i * 2) + 1];

            // color
            uint32View[index++] = abgr;

            // texture id
            uint32View[index++] = textureIdAndRound;
        }
    }
}
