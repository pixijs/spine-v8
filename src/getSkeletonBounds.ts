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

import {
    type Bone,
    ClippingAttachment,
    MeshAttachment,
    RegionAttachment,
    type Skeleton
} from '@esotericsoftware/spine-core';

import type { Bounds } from 'pixi.js';

const QUAD_VERTS = new Float32Array(8);
const tempVerts:number[] = [];

export function getSkeletonBounds(skeleton:Skeleton, out:Bounds)
{
    out.clear();

    const rootBone = skeleton.getRootBone() as Bone;

    rootBone.x = 0;
    rootBone.y = 0;
    rootBone.scaleX = 1;
    rootBone.scaleY = -1;
    rootBone.rotation = 0;

    skeleton.updateWorldTransform();

    const drawOrder = skeleton.drawOrder;

    for (let i = 0, n = drawOrder.length; i < n; i++)
    {
        const slot = drawOrder[i];
        const attachment = slot.getAttachment();

        if (attachment instanceof RegionAttachment)
        {
            const temp = QUAD_VERTS;

            attachment.computeWorldVertices(slot, temp, 0, 2);

            // TODO this can be skipped if matrix is local??
            out.addVertexData(temp, 0, 8);
        }
        else if (attachment instanceof MeshAttachment)
        {
            attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, tempVerts, 0, 2);

            out.addVertexData(tempVerts as any as Float32Array, 0, attachment.worldVerticesLength);
        }
        else if (attachment instanceof ClippingAttachment)
        {
            console.warn('[Pixi Spine] ClippingAttachment bounds is not supported yet');
        }
    }
}
