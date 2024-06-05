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
    BigPool,
    collectAllRenderables,
    extensions, ExtensionType,
    InstructionSet,
    type Renderer,
    type RenderPipe,
    Texture
} from 'pixi.js';
import { BatchableClippedSpineSlot } from './BatchableClippedSpineSlot';
import { BatchableSpineSlot } from './BatchableSpineSlot';
import { Spine } from './Spine';
import { ClippingAttachment, Color, MeshAttachment, RegionAttachment, SkeletonClipping } from '@esotericsoftware/spine-core';

import type { Bone } from '@esotericsoftware/spine-core';

const QUAD_TRIANGLES = [0, 1, 2, 2, 3, 0];
const QUAD_VERTS = new Float32Array(8);
const lightColor = new Color();
const darkColor = new Color();

const clipper = new SkeletonClipping();

// eslint-disable-next-line max-len
export class SpinePipe implements RenderPipe<Spine>
{
    /** @ignore */
    static extension = {
        type: [
            ExtensionType.WebGLPipes,
            ExtensionType.WebGPUPipes,
            ExtensionType.CanvasPipes,
        ],
        name: 'spine',
    } as const;

    renderer: Renderer;

    private gpuSpineData:Record<string, any> = {};

    constructor(renderer: Renderer)
    {
        this.renderer = renderer;
    }

    validateRenderable(spine: Spine): boolean
    {
        spine.applyState();
        // loop through and see if the mesh lengths have changed..

        return spine.spineAttachmentsDirty;
    }

    addRenderable(spine: Spine, instructionSet:InstructionSet)
    {
        const gpuSpine = this.gpuSpineData[spine.uid] ||= { slotBatches: {} };

        const batcher = this.renderer.renderPipes.batch;

        const drawOrder = spine.skeleton.drawOrder;

        const roundPixels = (this.renderer._roundPixels | spine._roundPixels) as 0 | 1;

        spine.applyState();

        for (let i = 0, n = drawOrder.length; i < n; i++)
        {
            const slot = drawOrder[i];
            const attachment = slot.getAttachment();

            if (attachment instanceof RegionAttachment || attachment instanceof MeshAttachment)
            {
                const batchableSpineSlot = gpuSpine.slotBatches[attachment.name] ||= new BatchableSpineSlot();

                batchableSpineSlot.setData(
                    spine,
                    spine.getCachedData(slot, attachment),
                    (attachment.region?.texture.texture) || Texture.EMPTY,
                    roundPixels
                );

                batcher.addToBatch(batchableSpineSlot);
            }
            else if (attachment instanceof ClippingAttachment)
            {
                clipper.clipStart(slot, attachment);
            }
            else
            {
                clipper.clipEndWithSlot(slot);
            }

            const containerAttachment = spine._slotAttachments.find((mapping) => mapping.slot === slot);

            if (containerAttachment)
            {
                const container = containerAttachment.container;

                container.includeInBuild = true;
                collectAllRenderables(container, instructionSet, this.renderer.renderPipes);
                container.includeInBuild = false;
            }
        }

        clipper.clipEnd();
    }

    updateRenderable(spine: Spine)
    {
        // we assume that spine will always change its verts size..
        const gpuSpine = this.gpuSpineData[spine.uid];

        spine.applyState();

        const drawOrder = spine.skeleton.drawOrder;

        for (let i = 0, n = drawOrder.length; i < n; i++)
        {
            const slot = drawOrder[i];
            const attachment = slot.getAttachment();

            if (attachment instanceof RegionAttachment || attachment instanceof MeshAttachment)
            {
                const batchableSpineSlot = gpuSpine.slotBatches[attachment.name];

                batchableSpineSlot.batcher.updateElement(batchableSpineSlot);
            }
        }
    }

    destroyRenderable(spine: Spine)
    {
        // TODO remove the renderable from the batcher
        this.gpuSpineData[spine.uid] = null as any;
    }

    destroy()
    {
        this.gpuSpineData = null as any;
        this.renderer = null as any;
    }
}

extensions.add(SpinePipe);
